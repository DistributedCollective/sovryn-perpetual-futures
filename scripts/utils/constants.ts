export function getDeploymentAddresses() {
    const addresses = {
      
      ['0xBcc52A8713b09A537D85d5463154A20c9b7f43Ab'.toLowerCase()]: 'BTCUSD', // oracleS2Address
      ['0xBB5b346844dF63C328AEC50bB0e663f783d88bcC'.toLowerCase()]: 'rBTC' // collateral (marginTokenAddress), BTC equivalent
        
    };

    return addresses;
}

export function getExchangesURLs(network){
  const urls = {
    BSC_TESTNET: {
      domain: 'https://testnet.bitmex.com',
      baseUrl: '/api/v1',
      orderBookL2: '/orderBook/L2',
      userMargin: '/user/margin',
      traderState: '/position',
      order: '/order',
      adjustLeverage: '/position/leverage',
      closePosition: '/order/closePosition',
      fundingRate: '/funding',
    }
  }

  return urls[network];
}
