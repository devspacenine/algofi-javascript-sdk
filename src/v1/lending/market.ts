// IMPORTS

// external
import algosdk, {
  Algodv2,
  Transaction,
  getApplicationAddress,
  encodeUint64,
  SuggestedParams,
  assignGroupID
} from "algosdk"

// global
import { FIXED_3_SCALE_FACTOR, FIXED_6_SCALE_FACTOR, PERMISSIONLESS_SENDER_LOGIC_SIG, TEXT_ENCODER } from "./../globals"
import { Base64Encoder } from "./../encoder"
import { getApplicationGlobalState, getLocalStates, getAccountBalances } from "./../stateUtils"
import { getParams, getPaymentTxn } from "./../transactionUtils"
import AssetAmount from "./../assetAmount"
import AlgofiUser from "./../algofiUser"

// local
import { MarketType, MANAGER_STRINGS, MARKET_STRINGS } from "./lendingConfig"
import LendingClient from "./lendingClient"
import MarketConfig from "./marketConfig"
import Oracle from "./oracle"

// CONSTANTS

const CALC_USER_POSITION = true
const DONT_CALC_USER_POSITION = false

// INTERFACE

export default class Market {
  // constatns
  public localMinBalance: number = 414000

  // static
  public algod: Algodv2
  public lendingClient: LendingClient
  public managerAppId: number
  public appId: number
  public address: string
  public marketType: MarketType
  public underlyingAssetId: number
  public bAssetId: number

  // control
  public optInEnabled: boolean
  public supplyLimited: boolean
  public borrowLimitted: boolean

  // parameters
  public borrowFactor: number
  public collateralFactor: number
  public flashLoanFee: number
  public flashLoanProtocolFee: number
  public maxFlashLoanRatio: number
  public liquidationIncentive: number
  public liquidationFee: number
  public reserveFactor: number
  public underlyingSupplyCap: number
  public underlyingBorrowCap: number

  // interest rate model
  public baseInterestRate: number
  public baseInterestSlope: number
  public exponentialInterestAmplificationFactor: number
  public targetUtilizationRatio: number

  // oracle
  public oracle: Oracle

  // balance
  public underlyingCash: number
  public underlyingBorrowed: number
  public underlyingReserves: number
  public borrowShareCirculation: number
  public bAssetCirculation: number
  public activeBAssetCollateral: number
  public underlyingProtocolReserve: number // stbl only

  // interest
  public latestTime: number
  public borrowIndex: number
  public impliedBorrowIndex: number

  // calculated values
  public totalSupplied: AssetAmount
  public totalBorrowed: AssetAmount
  public supplyAPR: number
  public borrowAPR: number

  // TODO rewards

  constructor(algod: Algodv2, lendingClient: LendingClient, managerAppId: number, marketConfig: MarketConfig) {
    this.algod = algod
    this.lendingClient = lendingClient
    this.managerAppId = managerAppId
    this.appId = marketConfig.appId
    this.address = getApplicationAddress(this.appId)
    this.marketType = marketConfig.marketType
    this.underlyingAssetId = marketConfig.underlyingAssetId
    this.bAssetId = marketConfig.bAssetId
  }

  async loadState() {
    let state = await getApplicationGlobalState(this.algod, this.appId)

    // parameters
    this.borrowFactor = state[MARKET_STRINGS.borrow_factor]
    this.collateralFactor = state[MARKET_STRINGS.collateral_factor]
    this.flashLoanFee = state[MARKET_STRINGS.flash_loan_fee]
    this.flashLoanProtocolFee = state[MARKET_STRINGS.flash_loan_protocol_fee]
    this.maxFlashLoanRatio = state[MARKET_STRINGS.max_flash_loan_ratio]
    this.liquidationIncentive = state[MARKET_STRINGS.liquidation_incentive]
    this.liquidationFee = state[MARKET_STRINGS.liquidation_fee]
    this.reserveFactor = state[MARKET_STRINGS.reserve_factor]
    this.underlyingSupplyCap = state[MARKET_STRINGS.underlying_supply_cap]
    this.underlyingBorrowCap = state[MARKET_STRINGS.underlying_borrow_cap]

    // interest rate model
    this.baseInterestRate = state[MARKET_STRINGS.base_interest_rate]
    this.baseInterestSlope = state[MARKET_STRINGS.base_interest_slope]
    this.exponentialInterestAmplificationFactor = state[MARKET_STRINGS.exponential_interest_amplification_factor]
    this.targetUtilizationRatio = state[MARKET_STRINGS.target_utilization_ratio]

    // oracle
    this.oracle = new Oracle(
      this.algod,
      state[MARKET_STRINGS.oracle_app_id],
      Base64Encoder.decode(state[MARKET_STRINGS.oracle_price_field_name]),
      state[MARKET_STRINGS.oracle_price_scale_factor]
    )
    await this.oracle.loadPrice()

    // balance
    this.underlyingCash = state[MARKET_STRINGS.underlying_cash]
    this.underlyingBorrowed = state[MARKET_STRINGS.underlying_borrowed]
    this.underlyingReserves = state[MARKET_STRINGS.underlying_reserves]
    this.borrowShareCirculation = state[MARKET_STRINGS.borrow_share_circulation]
    this.bAssetCirculation = state[MARKET_STRINGS.b_asset_circulation]
    this.activeBAssetCollateral = state[MARKET_STRINGS.active_b_asset_collateral]
    this.underlyingProtocolReserve = state[MARKET_STRINGS.underlying_protocol_reserve] || 0

    // interest
    this.latestTime = state[MARKET_STRINGS.latest_time]
    this.borrowIndex = state[MARKET_STRINGS.borrow_index]
    this.impliedBorrowIndex = state[MARKET_STRINGS.implied_borrow_index]

    // calculated values
    this.totalSupplied = new AssetAmount(
      this.getUnderlyingSupplied() /
        Math.pow(10, this.lendingClient.algofiClient.assets[this.underlyingAssetId].decimals),
      this.convertUnderlyingToUSD(this.getUnderlyingSupplied())
    )

    this.totalBorrowed = new AssetAmount(
      this.underlyingBorrowed / Math.pow(10, this.lendingClient.algofiClient.assets[this.underlyingAssetId].decimals),
      this.convertUnderlyingToUSD(this.underlyingBorrowed)
    )

    let [supplyAPR, borrowAPR] = this.getAPRs(this.totalSupplied.underlying, this.totalBorrowed.underlying)
    this.supplyAPR = supplyAPR
    this.borrowAPR = borrowAPR

    // TODO rewards
  }

  // GETTERS

  getUnderlyingSupplied(): number {
    if (this.marketType == MarketType.STBL) {
      return this.underlyingCash
    } else {
      return this.underlyingBorrowed + this.underlyingCash - this.underlyingReserves
    }
  }

  getAPRs(totalSupplied: number, totalBorrowed: number): [number, number] {
    let borrowUtilization = totalBorrowed / totalSupplied || 0
    let borrowAPR = this.baseInterestRate / FIXED_6_SCALE_FACTOR
    borrowAPR += (borrowUtilization * this.baseInterestSlope) / FIXED_6_SCALE_FACTOR
    if (borrowUtilization > this.targetUtilizationRatio / FIXED_6_SCALE_FACTOR) {
      borrowAPR +=
        this.exponentialInterestAmplificationFactor *
        Math.pow(borrowUtilization - this.targetUtilizationRatio / FIXED_6_SCALE_FACTOR, 2)
    }

    let supplyAPR = borrowAPR * borrowUtilization * (1 - this.reserveFactor / FIXED_3_SCALE_FACTOR)
    return [supplyAPR, borrowAPR]
  }

  // CONVERSIONS

  convertUnderlyingToUSD(amount: number): number {
    return (amount * this.oracle.rawPrice) / (this.oracle.scaleFactor * FIXED_3_SCALE_FACTOR)
  }

  bAssetToAssetAmount(amount: number): AssetAmount {
    if (amount == 0) {
      return new AssetAmount(0, 0)
    }
    let rawUnderlyingAmount = (amount * this.getUnderlyingSupplied()) / this.bAssetCirculation
    let underlyingAmount =
      rawUnderlyingAmount / Math.pow(10, this.lendingClient.algofiClient.assets[this.underlyingAssetId].decimals)
    let usdAmount = this.convertUnderlyingToUSD(rawUnderlyingAmount)
    return new AssetAmount(underlyingAmount, usdAmount)
  }

  borrowSharesToAssetAmount(amount: number): AssetAmount {
    if (amount == 0) {
      return new AssetAmount(0, 0)
    }
    let rawUnderlyingAmount = (amount * this.underlyingBorrowed) / this.borrowShareCirculation
    let underlyingAmount =
      rawUnderlyingAmount / Math.pow(10, this.lendingClient.algofiClient.assets[this.underlyingAssetId].decimals)
    let usdAmount = this.convertUnderlyingToUSD(rawUnderlyingAmount)
    return new AssetAmount(underlyingAmount, usdAmount)
  }

  underlyingToBAssetAmount(amount: number): number {
    return (amount * this.bAssetCirculation) / this.getUnderlyingSupplied()
  }

  // TRANSACTIONS

  async getPreambleTransactions(
    params: SuggestedParams,
    user: AlgofiUser,
    needsUserPosition: boolean
  ): Promise<[Transaction[], number]> {
    const preamble = []

    if (!user.isOptedInToAsset(this.underlyingAssetId)) {
      preamble.push(getPaymentTxn(params, user.address, user.address, this.underlyingAssetId, 0))
    }

    if (!user.isOptedInToAsset(this.bAssetId)) {
      preamble.push(getPaymentTxn(params, user.address, user.address, this.bAssetId, 0))
    }

    let additionalFee = 0
    if (needsUserPosition) {
      let calcUserPositionTxns = await user.lending.getCalcUserPositionTransactions(this.appId)
      additionalFee = calcUserPositionTxns.length * 1000
      calcUserPositionTxns.every(txn => {
        preamble.push(txn)
      })
    }

    return [preamble, additionalFee]
  }

  async getMintTxns(user: AlgofiUser, underlyingAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Mint action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(
      params,
      user,
      DONT_CALC_USER_POSITION
    )

    // payment
    const txn0 = getPaymentTxn(params, user.address, this.address, this.underlyingAssetId, underlyingAmount)

    // application call
    params.fee = 2000
    const txn1 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.mint_b_asset)],
      accounts: undefined,
      foreignApps: [this.managerAppId],
      foreignAssets: [this.bAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0, txn1]))
  }

  async getAddUnderlyingCollateralTxns(user: AlgofiUser, underlyingAmount: number): Promise<Transaction[]> {
    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(
      params,
      user,
      DONT_CALC_USER_POSITION
    )

    // payment
    const targetAddress = this.marketType != MarketType.VAULT ? this.address : user.lending.storageAddress
    const txn0 = getPaymentTxn(params, user.address, targetAddress, this.underlyingAssetId, underlyingAmount)

    // application call
    params.fee = 1000
    const txn1 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.add_underlying_collateral)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: undefined,
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0, txn1]))
  }

  async getAddBAssetCollateralTxns(user: AlgofiUser, bAssetAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Add b asset collateral action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(
      params,
      user,
      DONT_CALC_USER_POSITION
    )

    // payment
    const txn0 = getPaymentTxn(params, user.address, this.address, this.bAssetId, bAssetAmount)

    // application call
    params.fee = 1000
    const txn1 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.add_b_asset_collateral)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: undefined,
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0, txn1]))
  }

  async getRemoveUnderlyingCollateralTxns(user: AlgofiUser, bAssetAmount: number): Promise<Transaction[]> {
    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(params, user, CALC_USER_POSITION)

    // application call
    params.fee = this.marketType != MarketType.VAULT ? 2000 + additionalFee : 3000 + additionalFee
    const txn0 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.remove_underlying_collateral), encodeUint64(bAssetAmount)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: [this.underlyingAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0]))
  }

  async getRemoveBAssetCollateralTxns(user: AlgofiUser, bAssetAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Remove b asset collateral action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(params, user, CALC_USER_POSITION)

    // application call
    params.fee = 2000 + additionalFee
    const txn0 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.remove_b_asset_collateral), encodeUint64(bAssetAmount)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: [this.bAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0]))
  }

  async getBurnTxns(user: AlgofiUser, bAssetAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Burn action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(
      params,
      user,
      DONT_CALC_USER_POSITION
    )

    // payment
    const txn0 = getPaymentTxn(params, user.address, this.address, this.bAssetId, bAssetAmount)

    // application call
    params.fee = 2000
    const txn1 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.burn_b_asset)],
      accounts: undefined,
      foreignApps: [this.managerAppId],
      foreignAssets: [this.underlyingAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0, txn1]))
  }

  async getBorrowTxns(user: AlgofiUser, underlyingAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Borrow action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(params, user, CALC_USER_POSITION)

    // application call
    params.fee = 2000 + additionalFee
    const txn0 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.borrow), encodeUint64(underlyingAmount)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: [this.underlyingAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0]))
  }

  async getRepayBorrowTxns(user: AlgofiUser, underlyingAmount: number): Promise<Transaction[]> {
    if (this.marketType == MarketType.VAULT) {
      throw "Repay borrow action not supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    const [preambleTransactions, additionalFee] = await this.getPreambleTransactions(
      params,
      user,
      DONT_CALC_USER_POSITION
    )

    // payment
    const txn0 = getPaymentTxn(params, user.address, this.address, this.underlyingAssetId, underlyingAmount)

    // application call
    params.fee = 2000
    const txn1 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.repay_borrow)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: [this.underlyingAssetId],
      rekeyTo: undefined
    })

    return assignGroupID(preambleTransactions.concat([txn0, txn1]))
  }

  // vault specific actions

  async getSyncVaultTxns(user: AlgofiUser): Promise<Transaction[]> {
    if (this.marketType != MarketType.VAULT) {
      throw "Sync vault action only supported by vault market"
    }

    const params = await getParams(this.algod)
    const transactions = []

    // application call
    const txn0 = algosdk.makeApplicationNoOpTxnFromObject({
      from: user.address,
      appIndex: this.appId,
      suggestedParams: params,
      appArgs: [TEXT_ENCODER.encode(MARKET_STRINGS.sync_vault)],
      accounts: [user.lending.storageAddress],
      foreignApps: [this.managerAppId],
      foreignAssets: [this.underlyingAssetId],
      rekeyTo: undefined
    })

    return assignGroupID([txn0])
  }
}
