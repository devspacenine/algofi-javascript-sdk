// IMPORTS

// global
import { Network } from "../../globals"

// local
import { MarketType } from "./lendingConfig"

// INTERFACE

export default class MarketConfig {
  public appId: number
  public underlyingAssetId: number
  public bAssetId: number
  public marketType: MarketType

  /**
   * Constructor for the market config class
   * 
   * @param appId - market app id
   * @param underlyingAssetId - underlying asset id
   * @param bAssetId - b asset id
   * @param marketType - market type
   */
  constructor(appId: number, underlyingAssetId: number, bAssetId: number, marketType: MarketType) {
    this.appId = appId
    this.underlyingAssetId = underlyingAssetId
    this.bAssetId = bAssetId
    this.marketType = marketType
  }
}

export const MarketConfigs = {
  [Network.MAINNET]: [
    new MarketConfig(0, 1, 0, MarketType.STANDARD) // ALGO
  ],
  [Network.MAINNET_CLONE]: [
    new MarketConfig(753107352, 1, 753117075, MarketType.STANDARD), // ALGO
    new MarketConfig(753108247, 753101315, 753119272, MarketType.STANDARD), // USDC
    new MarketConfig(753108576, 753101485, 753119789, MarketType.STANDARD), // USDT
    new MarketConfig(753109347, 753101784, 753120193, MarketType.STBL), // STBL
    new MarketConfig(753110308, 753102180, 753120742, MarketType.STANDARD), // GOBTC
    new MarketConfig(753110704, 753102376, 753121086, MarketType.STANDARD), // GOETH
    new MarketConfig(753110470, 753103642, 753121416, MarketType.STANDARD), // WBTC
    new MarketConfig(753110943, 753103963, 753121726, MarketType.STANDARD), // WETH
    new MarketConfig(753111321, 753104158, 753122003, MarketType.STANDARD), // WSOL
    new MarketConfig(753111740, 753104718, 753122293, MarketType.STANDARD), // BANK
    new MarketConfig(753112308, 1, 753122631, MarketType.VAULT) // vALGO
  ],
  [Network.MAINNET_CLONE2]: [
    new MarketConfig(802880734, 1, 802887010, MarketType.STANDARD), // ALGO
    new MarketConfig(802881530, 802871797, 802887476, MarketType.STANDARD), // USDC
    new MarketConfig(802882874, 802872834, 802887973, MarketType.STBL), // STBL2
    new MarketConfig(802881983, 802873705, 802888469, MarketType.STANDARD), // GOBTC
    new MarketConfig(802882365, 802874445, 802888853, MarketType.STANDARD), // GOETH
    new MarketConfig(802883364, 1, 802889344, MarketType.VAULT) // vALGO
  ],
  [Network.MAINNET_CLONE3]: [
    new MarketConfig(812905712, 1, 812910520, MarketType.STANDARD), // ALGO
    new MarketConfig(812916046, 812915205, 812916935, MarketType.STANDARD), // USDC
    new MarketConfig(812930890, 812930638, 812931295, MarketType.STANDARD), // USDT
    new MarketConfig(812935796, 812932283, 812936076, MarketType.STBL), // STBL2
    new MarketConfig(812919965, 812919854, 812920370, MarketType.STANDARD), // GOBTC
    new MarketConfig(812923132, 812922836, 812924856, MarketType.STANDARD), // GOETH
    new MarketConfig(812928007, 1, 812928844, MarketType.VAULT) // vALGO
  ],
  [Network.TESTNET]: [
    new MarketConfig(91635808, 1, 91638233, MarketType.STANDARD),
    new MarketConfig(91636097, 91634316, 91638306, MarketType.STANDARD),
    new MarketConfig(91636162, 91634828, 91638392, MarketType.STANDARD),
    new MarketConfig(91636638, 91634454, 91638538, MarketType.STANDARD),
    new MarketConfig(91636680, 91634487, 91638603, MarketType.STANDARD),
    new MarketConfig(91636742, 91634534, 91638687, MarketType.STANDARD),
    new MarketConfig(91636787, 91634562, 91638794, MarketType.STANDARD),
    new MarketConfig(91636896, 91634691, 91638864, MarketType.STANDARD),
    new MarketConfig(91637209, 1, 91639146, MarketType.VAULT),
    new MarketConfig(91637110, 91634578, 91638952, MarketType.STBL),
    new MarketConfig(91636998, 91634736, 91639074, MarketType.STANDARD)
  ]
}