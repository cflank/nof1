# 🤖 AI指令驱动交易系统架构设计

## 📊 系统概览

```
Market Data → AI Prompt → AI Response → Command Parser → Trading Executor → Binance API
     ↑                                                           ↓
     └─────────────── Feedback Loop ←─────────────── Trade Results
```

## 🎯 核心组件设计

### 1. AI交互层 (AI Interaction Layer)

```typescript
interface AITradingService {
  // 核心方法
  requestTradingDecision(marketData: MarketData): Promise<AIResponse>
  parseInstructions(aiResponse: string): TradingInstruction[]
  validateInstructions(instructions: TradingInstruction[]): ValidationResult
}

interface MarketData {
  timestamp: number;
  symbols: SymbolData[];
  accountInfo: AccountSummary;
  currentPositions: Position[];
  marketTrends: TrendAnalysis;
  riskMetrics: RiskMetrics;
}

interface SymbolData {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  volatility: number;
  technicalIndicators: {
    rsi: number;
    macd: number;
    ema20: number;
    ema50: number;
    support: number;
    resistance: number;
  };
}

interface TradingInstruction {
  action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD' | 'SET_STOP_LOSS' | 'SET_TAKE_PROFIT';
  symbol: string;
  quantity?: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
  confidence: number; // 0-100
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}
```

### 2. 提示词模板系统 (Prompt Template System)

```typescript
interface PromptTemplate {
  name: string;
  version: string;
  systemPrompt: string;
  marketDataPrompt: string;
  riskConstraints: string;
  outputFormat: string;
}

// 示例模板
const NOF1_STYLE_TEMPLATE: PromptTemplate = {
  name: "nof1-aggressive-trading",
  version: "1.0",
  systemPrompt: `
    You are an advanced cryptocurrency trading AI, similar to the agents on nof1.ai.
    Your goal is to generate profitable trading decisions based on market analysis.

    Trading Rules:
    - Only trade on Binance Futures
    - Use leverage between 1x-20x
    - Always set stop-loss and take-profit levels
    - Maximum risk per trade: 2% of portfolio
    - Focus on major cryptocurrencies: BTC, ETH, ADA, DOGE, etc.

    Response Format:
    Provide your trading decisions in this exact format:

    TRADE_DECISION:
    Action: [BUY/SELL/CLOSE/HOLD]
    Symbol: [e.g., BTCUSDT]
    Quantity: [amount in base currency]
    Leverage: [1-20]
    Entry Price: [target price or MARKET]
    Stop Loss: [price level]
    Take Profit: [price level]
    Confidence: [0-100]
    Reason: [detailed explanation]
    ---
  `,
  marketDataPrompt: `
    Current Market Data:
    Timestamp: {timestamp}

    Portfolio Status:
    Available Balance: {available_balance} USDT
    Current Positions: {current_positions}

    Market Analysis:
    {market_symbols}

    Market Sentiment: {market_sentiment}
    Fear & Greed Index: {fear_greed_index}
  `,
  riskConstraints: `
    Risk Management Constraints:
    - Maximum position size: {max_position_size} USDT
    - Maximum leverage: {max_leverage}x
    - Stop loss required: {stop_loss_required}
    - Maximum daily trades: {max_daily_trades}
  `,
  outputFormat: `
    IMPORTANT: Your response must contain one or more TRADE_DECISION blocks.
    If no trading opportunities, respond with Action: HOLD
  `
};
```

### 3. AI服务提供商适配器 (AI Provider Adapters)

```typescript
interface AIProvider {
  name: string;
  requestDecision(prompt: string): Promise<string>;
  supportsStreaming: boolean;
  costPerRequest: number;
  rateLimitPerMinute: number;
}

class OpenAIAdapter implements AIProvider {
  name = "OpenAI GPT-4";

  async requestDecision(prompt: string): Promise<string> {
    // OpenAI API调用
    const response = await this.openaiClient.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });
    return response.choices[0].message.content;
  }
}

class ClaudeAdapter implements AIProvider {
  name = "Anthropic Claude";

  async requestDecision(prompt: string): Promise<string> {
    // Claude API调用
    const response = await this.anthropicClient.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    });
    return response.content[0].text;
  }
}

class DeepSeekAdapter implements AIProvider {
  name = "DeepSeek Chat";

  async requestDecision(prompt: string): Promise<string> {
    // DeepSeek API调用
    const response = await this.deepseekClient.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 2000
    });
    return response.choices[0].message.content;
  }
}
```

### 4. 指令解析器 (Command Parser)

```typescript
class TradingInstructionParser {

  parseAIResponse(response: string): TradingInstruction[] {
    const instructions: TradingInstruction[] = [];

    // 正则表达式匹配TRADE_DECISION块
    const tradeBlocks = response.match(/TRADE_DECISION:(.*?)(?=TRADE_DECISION:|$)/gs);

    if (!tradeBlocks) {
      throw new Error("No valid trading decisions found in AI response");
    }

    for (const block of tradeBlocks) {
      const instruction = this.parseTradeBlock(block);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    return instructions;
  }

  private parseTradeBlock(block: string): TradingInstruction | null {
    const lines = block.split('\n').map(line => line.trim());
    const instruction: Partial<TradingInstruction> = {};

    for (const line of lines) {
      if (line.startsWith('Action:')) {
        instruction.action = line.split(':')[1].trim() as any;
      } else if (line.startsWith('Symbol:')) {
        instruction.symbol = line.split(':')[1].trim();
      } else if (line.startsWith('Quantity:')) {
        instruction.quantity = parseFloat(line.split(':')[1].trim());
      } else if (line.startsWith('Leverage:')) {
        instruction.leverage = parseInt(line.split(':')[1].trim());
      } else if (line.startsWith('Stop Loss:')) {
        instruction.stopLoss = parseFloat(line.split(':')[1].trim());
      } else if (line.startsWith('Take Profit:')) {
        instruction.takeProfit = parseFloat(line.split(':')[1].trim());
      } else if (line.startsWith('Confidence:')) {
        instruction.confidence = parseInt(line.split(':')[1].trim());
      } else if (line.startsWith('Reason:')) {
        instruction.reason = line.split(':')[1].trim();
      }
    }

    // 验证必填字段
    if (instruction.action && instruction.symbol) {
      return instruction as TradingInstruction;
    }

    return null;
  }

  validateInstruction(instruction: TradingInstruction): ValidationResult {
    const errors: string[] = [];

    // 基本验证
    if (!['BUY', 'SELL', 'CLOSE', 'HOLD'].includes(instruction.action)) {
      errors.push(`Invalid action: ${instruction.action}`);
    }

    if (instruction.action !== 'HOLD' && !instruction.symbol) {
      errors.push("Symbol is required for trading actions");
    }

    if (instruction.leverage && (instruction.leverage < 1 || instruction.leverage > 20)) {
      errors.push(`Invalid leverage: ${instruction.leverage}. Must be 1-20`);
    }

    if (instruction.confidence < 0 || instruction.confidence > 100) {
      errors.push(`Invalid confidence: ${instruction.confidence}. Must be 0-100`);
    }

    // 风险检查
    if (instruction.action === 'BUY' || instruction.action === 'SELL') {
      if (!instruction.stopLoss) {
        errors.push("Stop loss is required for new positions");
      }
      if (!instruction.takeProfit) {
        errors.push("Take profit is required for new positions");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }
}
```

### 5. 市场数据聚合器 (Market Data Aggregator)

```typescript
class MarketDataAggregator {

  async gatherMarketData(symbols: string[]): Promise<MarketData> {
    const [
      accountInfo,
      currentPositions,
      priceData,
      technicalData,
      sentimentData
    ] = await Promise.all([
      this.binanceService.getAccountInfo(),
      this.binanceService.getPositions(),
      this.getPriceData(symbols),
      this.getTechnicalIndicators(symbols),
      this.getMarketSentiment()
    ]);

    return {
      timestamp: Date.now(),
      symbols: this.formatSymbolData(priceData, technicalData),
      accountInfo: this.formatAccountInfo(accountInfo),
      currentPositions,
      marketTrends: await this.analyzeTrends(priceData),
      riskMetrics: this.calculateRiskMetrics(currentPositions)
    };
  }

  private async getTechnicalIndicators(symbols: string[]): Promise<Record<string, any>> {
    const indicators: Record<string, any> = {};

    for (const symbol of symbols) {
      // 获取K线数据计算技术指标
      const klines = await this.binanceService.getKlines(symbol, '1h', 100);

      indicators[symbol] = {
        rsi: this.calculateRSI(klines),
        macd: this.calculateMACD(klines),
        ema20: this.calculateEMA(klines, 20),
        ema50: this.calculateEMA(klines, 50),
        support: this.calculateSupport(klines),
        resistance: this.calculateResistance(klines),
        volatility: this.calculateVolatility(klines)
      };
    }

    return indicators;
  }

  private async getMarketSentiment(): Promise<any> {
    // 可以集成多个数据源
    const [fearGreedIndex, newssentiment] = await Promise.all([
      this.getFearGreedIndex(),
      this.getNewsSentiment()
    ]);

    return {
      fearGreedIndex,
      newssentiment,
      overallSentiment: this.calculateOverallSentiment(fearGreedIndex, newssentiment)
    };
  }
}
```

### 6. AI交易服务 (AI Trading Service)

```typescript
class AITradingService {

  constructor(
    private aiProvider: AIProvider,
    private promptTemplate: PromptTemplate,
    private marketDataAggregator: MarketDataAggregator,
    private instructionParser: TradingInstructionParser,
    private tradingExecutor: TradingExecutor
  ) {}

  async executeAITradingCycle(): Promise<TradingCycleResult> {
    try {
      // 1. 收集市场数据
      const marketData = await this.marketDataAggregator.gatherMarketData(
        ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOGEUSDT']
      );

      // 2. 构建AI提示词
      const prompt = this.buildPrompt(marketData);

      // 3. 请求AI决策
      const aiResponse = await this.aiProvider.requestDecision(prompt);

      // 4. 解析交易指令
      const instructions = this.instructionParser.parseAIResponse(aiResponse);

      // 5. 验证指令
      const validInstructions = instructions.filter(instruction => {
        const validation = this.instructionParser.validateInstruction(instruction);
        if (!validation.isValid) {
          console.warn(`Invalid instruction: ${validation.errors.join(', ')}`);
          return false;
        }
        return true;
      });

      // 6. 执行交易
      const results: ExecutionResult[] = [];
      for (const instruction of validInstructions) {
        if (instruction.action !== 'HOLD') {
          const result = await this.tradingExecutor.executeInstruction(instruction);
          results.push(result);
        }
      }

      return {
        timestamp: Date.now(),
        aiProvider: this.aiProvider.name,
        prompt,
        aiResponse,
        instructions: validInstructions,
        executionResults: results,
        success: true
      };

    } catch (error) {
      console.error('AI Trading Cycle Error:', error);
      return {
        timestamp: Date.now(),
        aiProvider: this.aiProvider.name,
        error: error.message,
        success: false
      };
    }
  }

  private buildPrompt(marketData: MarketData): string {
    let prompt = this.promptTemplate.systemPrompt + '\n\n';

    // 替换模板变量
    prompt += this.promptTemplate.marketDataPrompt
      .replace('{timestamp}', new Date(marketData.timestamp).toISOString())
      .replace('{available_balance}', marketData.accountInfo.availableBalance.toString())
      .replace('{current_positions}', JSON.stringify(marketData.currentPositions, null, 2))
      .replace('{market_symbols}', this.formatMarketSymbols(marketData.symbols))
      .replace('{market_sentiment}', marketData.marketTrends.overallSentiment)
      .replace('{fear_greed_index}', marketData.riskMetrics.fearGreedIndex?.toString() || 'N/A');

    prompt += '\n\n' + this.promptTemplate.riskConstraints
      .replace('{max_position_size}', '1000')
      .replace('{max_leverage}', '10')
      .replace('{stop_loss_required}', 'true')
      .replace('{max_daily_trades}', '5');

    prompt += '\n\n' + this.promptTemplate.outputFormat;

    return prompt;
  }

  private formatMarketSymbols(symbols: SymbolData[]): string {
    return symbols.map(symbol =>
      `${symbol.symbol}: $${symbol.currentPrice} (${symbol.priceChange24h > 0 ? '+' : ''}${symbol.priceChange24h.toFixed(2)}%)
      RSI: ${symbol.technicalIndicators.rsi.toFixed(2)},
      Volume: ${(symbol.volume24h / 1000000).toFixed(2)}M`
    ).join('\n');
  }
}
```

### 7. 执行器增强 (Enhanced Trading Executor)

```typescript
class AITradingExecutor extends TradingExecutor {

  async executeInstruction(instruction: TradingInstruction): Promise<ExecutionResult> {
    try {
      // 记录AI指令
      await this.logAIInstruction(instruction);

      // 执行前最终检查
      const preExecutionCheck = await this.performPreExecutionCheck(instruction);
      if (!preExecutionCheck.canExecute) {
        return {
          success: false,
          instruction,
          error: preExecutionCheck.reason,
          timestamp: Date.now()
        };
      }

      let result: ExecutionResult;

      switch (instruction.action) {
        case 'BUY':
        case 'SELL':
          result = await this.executeEntry(instruction);
          break;
        case 'CLOSE':
          result = await this.executeExit(instruction);
          break;
        case 'SET_STOP_LOSS':
          result = await this.setStopLoss(instruction);
          break;
        case 'SET_TAKE_PROFIT':
          result = await this.setTakeProfit(instruction);
          break;
        default:
          throw new Error(`Unsupported action: ${instruction.action}`);
      }

      // 发送通知
      if (result.success) {
        await this.notificationService.sendAITradeNotification(instruction, result);
      }

      return result;

    } catch (error) {
      console.error('Instruction execution error:', error);
      return {
        success: false,
        instruction,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  private async executeEntry(instruction: TradingInstruction): Promise<ExecutionResult> {
    // 1. 设置杠杆
    if (instruction.leverage) {
      await this.binanceService.setLeverage(instruction.symbol, instruction.leverage);
    }

    // 2. 执行入场订单
    const entryOrder = await this.binanceService.placeOrder({
      symbol: instruction.symbol,
      side: instruction.action as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity: instruction.quantity.toString(),
      leverage: instruction.leverage || 1
    });

    // 3. 设置止盈止损
    if (instruction.stopLoss) {
      await this.setStopLossOrder(instruction.symbol, instruction.stopLoss, instruction.action);
    }

    if (instruction.takeProfit) {
      await this.setTakeProfitOrder(instruction.symbol, instruction.takeProfit, instruction.action);
    }

    return {
      success: true,
      instruction,
      binanceOrderId: entryOrder.orderId,
      executedPrice: parseFloat(entryOrder.avgPrice),
      executedQuantity: parseFloat(entryOrder.executedQty),
      timestamp: Date.now()
    };
  }

  private async performPreExecutionCheck(instruction: TradingInstruction): Promise<{canExecute: boolean, reason?: string}> {
    // 账户余额检查
    const accountInfo = await this.binanceService.getAccountInfo();
    const requiredMargin = (instruction.quantity * instruction.price || 0) / (instruction.leverage || 1);

    if (requiredMargin > accountInfo.availableBalance * 0.95) {
      return {
        canExecute: false,
        reason: `Insufficient balance. Required: ${requiredMargin}, Available: ${accountInfo.availableBalance}`
      };
    }

    // 价格偏移检查
    if (instruction.price) {
      const currentPrice = await this.binanceService.getCurrentPrice(instruction.symbol);
      const priceDeviation = Math.abs(currentPrice - instruction.price) / instruction.price * 100;

      if (priceDeviation > 5) { // 5%偏移限制
        return {
          canExecute: false,
          reason: `Price deviation too high: ${priceDeviation.toFixed(2)}%`
        };
      }
    }

    // 风险管理检查
    const currentPositions = await this.binanceService.getPositions();
    const totalExposure = currentPositions.reduce((sum, pos) =>
      sum + Math.abs(parseFloat(pos.positionAmt)) * parseFloat(pos.markPrice), 0
    );

    if (totalExposure > accountInfo.totalWalletBalance * 3) { // 最大3倍总资产暴露
      return {
        canExecute: false,
        reason: `Total exposure exceeds limit: ${totalExposure}`
      };
    }

    return { canExecute: true };
  }
}
```

## 🎮 使用示例

### 命令行接口

```bash
# 启动AI交易（OpenAI GPT-4）
npm start -- ai-trade --provider openai --template nof1-aggressive --interval 300

# 启动AI交易（Claude）
npm start -- ai-trade --provider claude --template conservative --interval 600

# 启动AI交易（DeepSeek）
npm start -- ai-trade --provider deepseek --template scalping --interval 60

# 测试模式（只显示AI决策，不执行）
npm start -- ai-trade --provider openai --dry-run

# 自定义提示词
npm start -- ai-trade --provider claude --template custom --prompt-file ./my-prompt.txt

# 多AI并行（投票机制）
npm start -- ai-trade --providers openai,claude,deepseek --consensus-threshold 2
```

### 配置示例

```env
# AI Provider APIs
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
DEEPSEEK_API_KEY=sk-xxx

# AI Trading Settings
AI_TRADING_ENABLED=true
AI_DECISION_INTERVAL=300  # 5分钟
MAX_DAILY_AI_TRADES=10
AI_CONFIDENCE_THRESHOLD=70  # 只执行70%以上信心度的交易

# Risk Management
AI_MAX_POSITION_SIZE=1000  # USDT
AI_MAX_LEVERAGE=10
AI_REQUIRE_STOP_LOSS=true
AI_PRICE_DEVIATION_LIMIT=5  # 5%

# Fallback Settings
AI_FALLBACK_TO_HOLD=true  # AI失败时默认HOLD
AI_REQUEST_TIMEOUT=30000  # 30秒超时
```

## 📊 与原系统对比

| 特性 | 原跟单系统 | 新AI指令系统 |
|------|------------|--------------|
| 决策来源 | NOF1.ai Agent | 自主AI分析 |
| 反应速度 | 1小时延迟 | 实时决策 |
| 定制性 | 受限于Agent | 完全可定制 |
| 多样性 | 单一策略 | 多AI提供商 |
| 学习能力 | 无 | 可迭代优化 |
| 成本 | 免费 | AI API费用 |
| 可控性 | 被动跟随 | 主动控制 |

## 🔄 迁移策略

1. **保留现有基础设施**：继续使用Binance服务、风险管理等
2. **并行运行**：AI系统与跟单系统同时运行，对比效果
3. **逐步替换**：验证AI系统稳定性后逐步替换
4. **混合模式**：AI主导，跟单作为备用或验证

这个新架构将让你拥有一个完全自主的AI交易助手，能够根据实时市场数据做出智能交易决策！