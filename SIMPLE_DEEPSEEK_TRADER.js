// 🚀 简化版 DeepSeek 直接交易实现
// 这是一个最小可行版本，可以直接部署测试

const axios = require('axios');
const Binance = require('node-binance-api');
require('dotenv').config();

class SimpleDeepSeekTrader {
  constructor() {
    // 初始化 Binance API (测试网)
    this.binance = new Binance().options({
      APIKEY: process.env.BINANCE_API_KEY,
      APISECRET: process.env.BINANCE_SECRET_KEY,
      testnet: true, // 使用测试网！
      log: console.log
    });

    // DeepSeek 配置
    this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    this.deepseekBaseUrl = 'https://api.deepseek.com';

    // 交易配置
    this.config = {
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      maxRiskPerTrade: 0.02, // 2%
      maxPositions: 3,
      interval: 60000, // 1分钟检查一次
      testMode: true // 测试模式，不执行真实交易
    };

    this.isRunning = false;
    this.tradeHistory = [];
  }

  // 启动交易机器人
  async start() {
    console.log('🚀 Simple DeepSeek Trader Starting...');
    console.log('⚠️  Running in TEST MODE');

    this.isRunning = true;

    // 每1分钟执行一次分析
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.tradingCycle();
      }
    }, this.config.interval);

    // 立即执行一次
    await this.tradingCycle();
  }

  // 停止交易机器人
  stop() {
    console.log('🛑 Stopping trader...');
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  // 主要交易循环
  async tradingCycle() {
    try {
      console.log(`\n⏰ ${new Date().toISOString()} - Starting trading cycle`);

      // 1. 获取市场数据
      const marketData = await this.getMarketData();

      // 2. 获取账户信息
      const accountInfo = await this.getAccountInfo();

      // 3. 请求 DeepSeek 分析
      const decision = await this.getDeepSeekDecision(marketData, accountInfo);

      // 4. 风险检查
      const riskCheck = this.validateRisk(decision, accountInfo);

      if (!riskCheck.passed) {
        console.log('❌ Risk check failed:', riskCheck.reason);
        return;
      }

      // 5. 执行交易决策
      await this.executeDecision(decision);

    } catch (error) {
      console.error('❌ Trading cycle error:', error.message);
    }
  }

  // 获取市场数据
  async getMarketData() {
    try {
      const prices = await this.binance.prices();
      const symbols = this.config.symbols;

      const marketData = {
        timestamp: new Date().toISOString(),
        prices: {}
      };

      // 获取当前价格
      symbols.forEach(symbol => {
        marketData.prices[symbol] = parseFloat(prices[symbol]);
      });

      // 获取24小时变化
      const ticker24h = await this.binance.prevDay();
      symbols.forEach(symbol => {
        const data = ticker24h[symbol];
        if (data) {
          marketData.prices[symbol + '_change'] = parseFloat(data.priceChangePercent);
        }
      });

      console.log('📊 Market data:', marketData.prices);
      return marketData;

    } catch (error) {
      throw new Error(`Failed to get market data: ${error.message}`);
    }
  }

  // 获取账户信息
  async getAccountInfo() {
    try {
      const account = await this.binance.account();

      const accountInfo = {
        timestamp: new Date().toISOString(),
        totalBalance: 0,
        availableBalance: 0,
        positions: []
      };

      // 计算USDT余额
      const usdtBalance = account.balances.find(b => b.asset === 'USDT');
      if (usdtBalance) {
        accountInfo.availableBalance = parseFloat(usdtBalance.free);
        accountInfo.totalBalance = parseFloat(usdtBalance.free) + parseFloat(usdtBalance.locked);
      }

      console.log('💰 Account balance:', `${accountInfo.availableBalance} USDT`);
      return accountInfo;

    } catch (error) {
      throw new Error(`Failed to get account info: ${error.message}`);
    }
  }

  // 请求 DeepSeek 分析决策
  async getDeepSeekDecision(marketData, accountInfo) {
    try {
      const prompt = this.buildTradingPrompt(marketData, accountInfo);

      const response = await axios.post(`${this.deepseekBaseUrl}/v1/chat/completions`, {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a professional cryptocurrency trading AI.

            CRITICAL: You must respond ONLY with valid JSON in this exact format:
            {
              "action": "BUY|SELL|HOLD",
              "symbol": "BTCUSDT",
              "quantity_usdt": 100,
              "reasoning": "Brief explanation",
              "confidence": 85,
              "risk_score": 45
            }

            Rules:
            - Only trade BTC, ETH, SOL (USDT pairs)
            - Maximum 200 USDT per trade
            - Risk score 1-100 (higher = riskier)
            - Only respond with JSON, no other text`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      }, {
        headers: {
          'Authorization': `Bearer ${this.deepseekApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const aiResponse = response.data.choices[0].message.content;
      console.log('🤖 DeepSeek response:', aiResponse);

      // 解析JSON响应
      const decision = this.parseAIDecision(aiResponse);
      console.log('📈 Trading decision:', decision);

      return decision;

    } catch (error) {
      throw new Error(`DeepSeek API error: ${error.message}`);
    }
  }

  // 构建交易提示词
  buildTradingPrompt(marketData, accountInfo) {
    return `Current market analysis needed:

Market Data:
- BTC: $${marketData.prices.BTCUSDT} (24h: ${marketData.prices.BTCUSDT_change || 0}%)
- ETH: $${marketData.prices.ETHUSDT} (24h: ${marketData.prices.ETHUSDT_change || 0}%)
- SOL: $${marketData.prices.SOLUSDT} (24h: ${marketData.prices.SOLUSDT_change || 0}%)

Account Info:
- Available Balance: ${accountInfo.availableBalance} USDT
- Current Positions: ${accountInfo.positions.length}

Please analyze the market and provide a trading decision. Consider:
1. Current price trends
2. Risk management
3. Position sizing based on available balance
4. Market momentum

Respond with trading decision in JSON format only.`;
  }

  // 解析AI决策
  parseAIDecision(aiResponse) {
    try {
      // 尝试提取JSON
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const decision = JSON.parse(jsonMatch[0]);

      // 验证必需字段
      const required = ['action', 'symbol', 'quantity_usdt', 'reasoning', 'confidence', 'risk_score'];
      for (const field of required) {
        if (!(field in decision)) {
          throw new Error(`Missing field: ${field}`);
        }
      }

      return decision;

    } catch (error) {
      throw new Error(`Failed to parse AI decision: ${error.message}`);
    }
  }

  // 风险验证
  validateRisk(decision, accountInfo) {
    const checks = [];

    // 检查风险评分
    if (decision.risk_score > 80) {
      return { passed: false, reason: `Risk score too high: ${decision.risk_score}` };
    }

    // 检查交易金额
    if (decision.quantity_usdt > 200) {
      return { passed: false, reason: `Trade size too large: ${decision.quantity_usdt} USDT` };
    }

    // 检查余额
    if (decision.action === 'BUY' && decision.quantity_usdt > accountInfo.availableBalance) {
      return { passed: false, reason: `Insufficient balance: ${accountInfo.availableBalance} USDT` };
    }

    // 检查交易对
    if (!this.config.symbols.includes(decision.symbol)) {
      return { passed: false, reason: `Invalid symbol: ${decision.symbol}` };
    }

    return { passed: true };
  }

  // 执行交易决策
  async executeDecision(decision) {
    try {
      if (decision.action === 'HOLD') {
        console.log('💤 Decision: HOLD - No action taken');
        return;
      }

      // 在测试模式下，只记录不执行
      if (this.config.testMode) {
        console.log('🧪 TEST MODE - Would execute:', {
          action: decision.action,
          symbol: decision.symbol,
          amount: decision.quantity_usdt,
          reasoning: decision.reasoning
        });

        // 记录模拟交易
        this.tradeHistory.push({
          timestamp: new Date().toISOString(),
          action: decision.action,
          symbol: decision.symbol,
          amount_usdt: decision.quantity_usdt,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          risk_score: decision.risk_score,
          status: 'SIMULATED'
        });

        return;
      }

      // 真实交易执行 (仅在 testMode = false 时)
      console.log('⚠️  EXECUTING REAL TRADE:', decision);

      if (decision.action === 'BUY') {
        await this.executeBuy(decision);
      } else if (decision.action === 'SELL') {
        await this.executeSell(decision);
      }

    } catch (error) {
      console.error('❌ Failed to execute decision:', error.message);
    }
  }

  // 执行买入
  async executeBuy(decision) {
    try {
      // 计算买入数量
      const currentPrice = await this.binance.prices(decision.symbol);
      const quantity = (decision.quantity_usdt / parseFloat(currentPrice[decision.symbol])).toFixed(6);

      // 执行市价买入
      const result = await this.binance.marketBuy(decision.symbol, quantity);

      console.log('✅ Buy order executed:', result);

      // 记录交易
      this.tradeHistory.push({
        timestamp: new Date().toISOString(),
        action: 'BUY',
        symbol: decision.symbol,
        quantity: quantity,
        amount_usdt: decision.quantity_usdt,
        orderId: result.orderId,
        status: 'EXECUTED'
      });

    } catch (error) {
      throw new Error(`Buy execution failed: ${error.message}`);
    }
  }

  // 执行卖出
  async executeSell(decision) {
    // 这里需要根据实际持仓情况实现卖出逻辑
    console.log('🔄 Sell logic not fully implemented - would sell', decision);
  }

  // 获取交易历史
  getTradeHistory() {
    return this.tradeHistory;
  }

  // 获取统计信息
  getStats() {
    return {
      totalTrades: this.tradeHistory.length,
      isRunning: this.isRunning,
      config: this.config,
      lastUpdate: new Date().toISOString()
    };
  }
}

// 使用示例
async function main() {
  const trader = new SimpleDeepSeekTrader();

  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, stopping trader...');
    trader.stop();
    process.exit(0);
  });

  try {
    await trader.start();
  } catch (error) {
    console.error('❌ Failed to start trader:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，启动交易器
if (require.main === module) {
  main();
}

module.exports = SimpleDeepSeekTrader;