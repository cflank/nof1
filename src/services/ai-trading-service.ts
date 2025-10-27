/**
 * AI交易服务核心类
 * 统一协调AI决策、指令解析和交易执行
 */

import { logger } from '../utils/logger';
import { BaseAIProvider } from './ai-providers/base-provider';
import { AIInstructionParser, TradingInstruction, ParseResult } from './ai-instruction-parser';
import { BinanceService } from './binance-service';
import { TradingExecutor } from './trading-executor';
import { RiskManager } from './risk-manager';
import { PromptTemplate } from '../templates';
import { TelegramService } from './telegram-service';

export interface MarketData {
  timestamp: number;
  symbols: SymbolData[];
  accountInfo: AccountSummary;
  currentPositions: any[];
  marketTrends: TrendAnalysis;
  riskMetrics: RiskMetrics;
}

export interface SymbolData {
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

export interface AccountSummary {
  availableBalance: number;
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
  totalPositionInitialMargin: number;
}

export interface TrendAnalysis {
  overallSentiment: string;
  marketPhase: string;
  majorSupport: number;
  majorResistance: number;
  volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface RiskMetrics {
  portfolioExposure: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  averageRiskReward: number;
  fearGreedIndex?: number;
}

export interface TradingCycleResult {
  timestamp: number;
  aiProvider: string;
  prompt: string;
  aiResponse: string;
  instructions: TradingInstruction[];
  executionResults: ExecutionResult[];
  success: boolean;
  error?: string;
  cycleId: string;
  duration: number;
}

export interface ExecutionResult {
  success: boolean;
  instruction: TradingInstruction;
  binanceOrderId?: number;
  executedPrice?: number;
  executedQuantity?: number;
  error?: string;
  timestamp: number;
}

export interface AITradingConfig {
  // AI设置
  aiProvider: BaseAIProvider;
  template: PromptTemplate;

  // 交易设置
  tradingPairs: string[];
  maxPositions: number;
  maxDailyTrades: number;

  // 风险管理
  maxPortfolioExposure: number; // 百分比
  maxPositionSize: number; // USDT
  minConfidenceThreshold: number; // 0-100

  // 市场数据
  technicalIndicatorsEnabled: boolean;
  sentimentAnalysisEnabled: boolean;

  // 通知设置
  telegramEnabled: boolean;

  // 其他设置
  dryRun: boolean; // 测试模式
  intervalSeconds: number;
}

export class AITradingService {
  private config: AITradingConfig;
  private instructionParser: AIInstructionParser;
  private binanceService: BinanceService;
  private tradingExecutor: TradingExecutor;
  private riskManager: RiskManager;
  private telegramService?: TelegramService;

  private isRunning = false;
  private currentCycle = 0;
  private totalExecutedTrades = 0;
  private dailyTradeCount = 0;
  private lastResetDate = new Date().toDateString();

  constructor(config: AITradingConfig) {
    this.config = config;
    this.instructionParser = new AIInstructionParser();
    this.binanceService = new BinanceService();
    this.tradingExecutor = new TradingExecutor(this.binanceService);
    this.riskManager = new RiskManager();

    if (config.telegramEnabled) {
      this.telegramService = new TelegramService();
    }
  }

  /**
   * 启动AI交易服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('AI Trading Service is already running');
    }

    logger.info(`🤖 Starting AI Trading Service with ${this.config.aiProvider.name}`);
    logger.info(`📊 Template: ${this.config.template.name}`);
    logger.info(`⏱️  Interval: ${this.config.intervalSeconds} seconds`);
    logger.info(`🔄 Dry Run: ${this.config.dryRun ? 'YES' : 'NO'}`);

    // 验证连接
    await this.validateConnections();

    this.isRunning = true;

    // 发送启动通知
    if (this.telegramService) {
      await this.telegramService.sendMessage(
        `🚀 AI Trading Bot Started\n` +
        `Provider: ${this.config.aiProvider.name}\n` +
        `Template: ${this.config.template.name}\n` +
        `Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE TRADING'}`
      );
    }

    // 开始交易循环
    this.startTradingLoop();
  }

  /**
   * 停止AI交易服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping AI Trading Service...');
    this.isRunning = false;

    // 发送停止通知
    if (this.telegramService) {
      await this.telegramService.sendMessage(
        `⏹️ AI Trading Bot Stopped\n` +
        `Total Cycles: ${this.currentCycle}\n` +
        `Total Trades: ${this.totalExecutedTrades}`
      );
    }
  }

  /**
   * 执行单次AI交易周期
   */
  async executeAITradingCycle(): Promise<TradingCycleResult> {
    const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      logger.info(`🔄 Starting AI trading cycle ${this.currentCycle + 1} (${cycleId})`);

      // 重置每日交易计数
      this.resetDailyCountIfNeeded();

      // 检查是否超过每日交易限制
      if (this.dailyTradeCount >= this.config.maxDailyTrades) {
        logger.warn(`📊 Daily trade limit (${this.config.maxDailyTrades}) reached. Skipping cycle.`);
        return this.createSkippedCycleResult(cycleId, 'Daily trade limit reached', startTime);
      }

      // 1. 收集市场数据
      const marketData = await this.gatherMarketData();

      // 2. 构建AI提示词
      const prompt = this.buildPrompt(marketData);

      // 3. 请求AI决策
      logger.info('🧠 Requesting AI trading decision...');
      const aiResponse = await this.config.aiProvider.requestDecision(prompt);

      // 4. 解析交易指令
      const parseResult = this.instructionParser.parseAIResponse(aiResponse.content);

      // 5. 验证和过滤指令
      const validInstructions = this.filterInstructions(parseResult);

      // 6. 执行交易（如果不是测试模式）
      const executionResults: ExecutionResult[] = [];

      if (!this.config.dryRun && validInstructions.length > 0) {
        for (const instruction of validInstructions) {
          try {
            const result = await this.executeInstruction(instruction);
            executionResults.push(result);

            if (result.success) {
              this.totalExecutedTrades++;
              this.dailyTradeCount++;
            }
          } catch (error) {
            logger.error(`Failed to execute instruction for ${instruction.symbol}:`, error);
            executionResults.push({
              success: false,
              instruction,
              error: error.message,
              timestamp: Date.now()
            });
          }
        }
      }

      // 7. 记录和通知结果
      const result = this.createSuccessfulCycleResult(
        cycleId, aiResponse, parseResult, validInstructions, executionResults, startTime
      );

      await this.logCycleResult(result);

      this.currentCycle++;

      return result;

    } catch (error) {
      logger.error(`AI trading cycle ${cycleId} failed:`, error);

      const result = this.createFailedCycleResult(cycleId, error.message, startTime);
      await this.logCycleResult(result);

      return result;
    }
  }

  /**
   * 收集市场数据
   */
  private async gatherMarketData(): Promise<MarketData> {
    logger.info('📊 Gathering market data...');

    const [accountInfo, positions, priceData] = await Promise.all([
      this.binanceService.getAccountInfo(),
      this.binanceService.getPositions(),
      this.getPriceData()
    ]);

    const symbolData = await this.getSymbolData();
    const trendAnalysis = await this.analyzeTrends(symbolData);
    const riskMetrics = this.calculateRiskMetrics(positions, accountInfo);

    return {
      timestamp: Date.now(),
      symbols: symbolData,
      accountInfo: {
        availableBalance: parseFloat(accountInfo.availableBalance),
        totalWalletBalance: parseFloat(accountInfo.totalWalletBalance),
        totalUnrealizedProfit: parseFloat(accountInfo.totalUnrealizedProfit),
        totalMarginBalance: parseFloat(accountInfo.totalMarginBalance),
        totalPositionInitialMargin: parseFloat(accountInfo.totalPositionInitialMargin)
      },
      currentPositions: positions.filter(p => parseFloat(p.positionAmt) !== 0),
      marketTrends: trendAnalysis,
      riskMetrics
    };
  }

  /**
   * 获取交易对数据
   */
  private async getSymbolData(): Promise<SymbolData[]> {
    const symbolData: SymbolData[] = [];

    for (const symbol of this.config.tradingPairs) {
      try {
        const [ticker, technicalData] = await Promise.all([
          this.binanceService.get24hrTicker(symbol),
          this.getTechnicalIndicators(symbol)
        ]);

        symbolData.push({
          symbol,
          currentPrice: parseFloat(ticker.lastPrice),
          priceChange24h: parseFloat(ticker.priceChangePercent),
          volume24h: parseFloat(ticker.volume),
          volatility: this.calculateVolatility(ticker),
          technicalIndicators: technicalData
        });

      } catch (error) {
        logger.error(`Failed to get data for ${symbol}:`, error);
      }
    }

    return symbolData;
  }

  /**
   * 获取技术指标
   */
  private async getTechnicalIndicators(symbol: string): Promise<any> {
    if (!this.config.technicalIndicatorsEnabled) {
      return {
        rsi: 50,
        macd: 0,
        ema20: 0,
        ema50: 0,
        support: 0,
        resistance: 0
      };
    }

    try {
      // 获取K线数据
      const klines = await this.binanceService.getKlines(symbol, '1h', 100);

      return {
        rsi: this.calculateRSI(klines),
        macd: this.calculateMACD(klines),
        ema20: this.calculateEMA(klines, 20),
        ema50: this.calculateEMA(klines, 50),
        support: this.calculateSupport(klines),
        resistance: this.calculateResistance(klines)
      };
    } catch (error) {
      logger.error(`Failed to calculate technical indicators for ${symbol}:`, error);
      return {
        rsi: 50, macd: 0, ema20: 0, ema50: 0, support: 0, resistance: 0
      };
    }
  }

  /**
   * 构建AI提示词
   */
  private buildPrompt(marketData: MarketData): string {
    let prompt = this.config.template.systemPrompt + '\n\n';

    // 替换模板变量
    prompt += this.config.template.marketDataPrompt
      .replace('{timestamp}', new Date(marketData.timestamp).toISOString())
      .replace('{available_balance}', marketData.accountInfo.availableBalance.toString())
      .replace('{current_positions}', this.formatPositions(marketData.currentPositions))
      .replace('{total_portfolio_value}', marketData.accountInfo.totalWalletBalance.toString())
      .replace('{used_margin}', marketData.accountInfo.totalPositionInitialMargin.toString())
      .replace('{market_symbols}', this.formatMarketSymbols(marketData.symbols))
      .replace('{technical_summary}', this.formatTechnicalSummary(marketData.symbols))
      .replace('{market_sentiment}', marketData.marketTrends.overallSentiment)
      .replace('{fear_greed_index}', marketData.riskMetrics.fearGreedIndex?.toString() || 'N/A')
      .replace('{news_sentiment}', 'Neutral') // 可以集成新闻API
      .replace('{social_sentiment}', 'Neutral') // 可以集成社交媒体API
      .replace('{recent_events}', 'No major events') // 可以集成事件API
      .replace('{key_levels}', this.formatKeyLevels(marketData.symbols));

    // 添加风险约束
    prompt += '\n\n' + this.config.template.riskConstraints
      .replace('{max_position_size}', this.config.maxPositionSize.toString())
      .replace('{max_leverage}', '20')
      .replace('{stop_loss_required}', 'true')
      .replace('{max_daily_trades}', this.config.maxDailyTrades.toString())
      .replace('{max_exposure}', this.config.maxPortfolioExposure.toString())
      .replace('{min_confidence}', this.config.minConfidenceThreshold.toString())
      .replace('{max_correlation}', '80')
      .replace('{current_exposure}', marketData.riskMetrics.portfolioExposure.toString())
      .replace('{trades_today}', this.dailyTradeCount.toString())
      .replace('{win_rate}', marketData.riskMetrics.winRate.toString())
      .replace('{avg_risk_reward}', marketData.riskMetrics.averageRiskReward.toString());

    prompt += '\n\n' + this.config.template.outputFormat;

    return prompt;
  }

  /**
   * 过滤和验证交易指令
   */
  private filterInstructions(parseResult: ParseResult): TradingInstruction[] {
    const filtered: TradingInstruction[] = [];

    for (const instruction of parseResult.validInstructions) {
      // 检查置信度阈值
      if (instruction.confidence < this.config.minConfidenceThreshold) {
        logger.warn(`🔻 Skipping ${instruction.symbol} - confidence ${instruction.confidence}% below threshold ${this.config.minConfidenceThreshold}%`);
        continue;
      }

      // 检查交易对是否在允许列表中
      if (!this.config.tradingPairs.includes(instruction.symbol)) {
        logger.warn(`🚫 Skipping ${instruction.symbol} - not in allowed trading pairs`);
        continue;
      }

      // 跳过HOLD指令
      if (instruction.action === 'HOLD') {
        logger.info(`⏸️ AI recommends HOLD for ${instruction.symbol}`);
        continue;
      }

      filtered.push(instruction);
    }

    return filtered;
  }

  /**
   * 执行单个交易指令
   */
  private async executeInstruction(instruction: TradingInstruction): Promise<ExecutionResult> {
    logger.info(`📋 Executing ${instruction.action} for ${instruction.symbol} (confidence: ${instruction.confidence}%)`);

    try {
      // 风险检查
      const riskAssessment = await this.riskManager.assessRisk({
        symbol: instruction.symbol,
        side: instruction.action as 'BUY' | 'SELL',
        quantity: instruction.quantity || 0,
        leverage: instruction.leverage || 1,
        entryPrice: instruction.price
      } as any);

      if (!riskAssessment.canExecute) {
        throw new Error(`Risk check failed: ${riskAssessment.reasons.join(', ')}`);
      }

      // 执行交易
      const result = await this.tradingExecutor.executeInstruction(instruction);

      // 发送通知
      if (this.telegramService && result.success) {
        await this.telegramService.sendMessage(
          `✅ Trade Executed\n` +
          `${instruction.action} ${instruction.symbol}\n` +
          `Price: ${result.executedPrice}\n` +
          `Quantity: ${result.executedQuantity}\n` +
          `Confidence: ${instruction.confidence}%\n` +
          `Reason: ${instruction.reason}`
        );
      }

      return result;

    } catch (error) {
      logger.error(`Failed to execute ${instruction.action} for ${instruction.symbol}:`, error);

      return {
        success: false,
        instruction,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  // 辅助方法...
  private async validateConnections(): Promise<void> {
    // 验证Binance连接
    try {
      await this.binanceService.getAccountInfo();
      logger.info('✅ Binance connection validated');
    } catch (error) {
      throw new Error(`Binance connection failed: ${error.message}`);
    }

    // 验证AI提供商连接
    if ('validateConnection' in this.config.aiProvider) {
      const isValid = await (this.config.aiProvider as any).validateConnection();
      if (!isValid) {
        throw new Error(`${this.config.aiProvider.name} connection failed`);
      }
      logger.info(`✅ ${this.config.aiProvider.name} connection validated`);
    }
  }

  private startTradingLoop(): void {
    const loop = async () => {
      if (!this.isRunning) return;

      try {
        await this.executeAITradingCycle();
      } catch (error) {
        logger.error('Trading cycle error:', error);
      }

      // 安排下次执行
      if (this.isRunning) {
        setTimeout(loop, this.config.intervalSeconds * 1000);
      }
    };

    // 立即开始第一次循环
    setTimeout(loop, 0);
  }

  private resetDailyCountIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
      logger.info('📅 Daily trade count reset');
    }
  }

  // 格式化和计算方法...
  private formatPositions(positions: any[]): string {
    if (positions.length === 0) return 'No open positions';
    return positions.map(p =>
      `${p.symbol}: ${p.positionAmt} (${parseFloat(p.unRealizedProfit).toFixed(2)} USDT)`
    ).join('\n');
  }

  private formatMarketSymbols(symbols: SymbolData[]): string {
    return symbols.map(s =>
      `${s.symbol}: $${s.currentPrice.toFixed(2)} (${s.priceChange24h > 0 ? '+' : ''}${s.priceChange24h.toFixed(2)}%)`
    ).join('\n');
  }

  private formatTechnicalSummary(symbols: SymbolData[]): string {
    return symbols.map(s => {
      const rsi = s.technicalIndicators.rsi;
      const rsiStatus = rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral';
      return `${s.symbol}: RSI ${rsi.toFixed(1)} (${rsiStatus})`;
    }).join('\n');
  }

  private formatKeyLevels(symbols: SymbolData[]): string {
    return symbols.map(s =>
      `${s.symbol}: Support ${s.technicalIndicators.support.toFixed(2)}, Resistance ${s.technicalIndicators.resistance.toFixed(2)}`
    ).join('\n');
  }

  // 技术指标计算方法（简化版，实际应用中可以使用专业的技术分析库）
  private calculateRSI(klines: any[]): number {
    // RSI计算逻辑
    return 50; // 占位符
  }

  private calculateMACD(klines: any[]): number {
    // MACD计算逻辑
    return 0; // 占位符
  }

  private calculateEMA(klines: any[], period: number): number {
    // EMA计算逻辑
    return 0; // 占位符
  }

  private calculateSupport(klines: any[]): number {
    // 支撑位计算逻辑
    return 0; // 占位符
  }

  private calculateResistance(klines: any[]): number {
    // 阻力位计算逻辑
    return 0; // 占位符
  }

  private calculateVolatility(ticker: any): number {
    return Math.abs(parseFloat(ticker.priceChangePercent));
  }

  private async getPriceData(): Promise<any> {
    // 获取价格数据
    return {};
  }

  private async analyzeTrends(symbols: SymbolData[]): Promise<TrendAnalysis> {
    // 分析市场趋势
    return {
      overallSentiment: 'Neutral',
      marketPhase: 'Consolidation',
      majorSupport: 0,
      majorResistance: 0,
      volatilityLevel: 'MEDIUM'
    };
  }

  private calculateRiskMetrics(positions: any[], accountInfo: any): RiskMetrics {
    // 计算风险指标
    return {
      portfolioExposure: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      winRate: 0,
      averageRiskReward: 0
    };
  }

  // 结果创建方法...
  private createSuccessfulCycleResult(
    cycleId: string, aiResponse: any, parseResult: ParseResult,
    instructions: TradingInstruction[], executionResults: ExecutionResult[], startTime: number
  ): TradingCycleResult {
    return {
      timestamp: Date.now(),
      aiProvider: this.config.aiProvider.name,
      prompt: '', // 可以存储提示词
      aiResponse: aiResponse.content,
      instructions,
      executionResults,
      success: true,
      cycleId,
      duration: Date.now() - startTime
    };
  }

  private createFailedCycleResult(cycleId: string, error: string, startTime: number): TradingCycleResult {
    return {
      timestamp: Date.now(),
      aiProvider: this.config.aiProvider.name,
      prompt: '',
      aiResponse: '',
      instructions: [],
      executionResults: [],
      success: false,
      error,
      cycleId,
      duration: Date.now() - startTime
    };
  }

  private createSkippedCycleResult(cycleId: string, reason: string, startTime: number): TradingCycleResult {
    return {
      timestamp: Date.now(),
      aiProvider: this.config.aiProvider.name,
      prompt: '',
      aiResponse: `Cycle skipped: ${reason}`,
      instructions: [],
      executionResults: [],
      success: true,
      cycleId,
      duration: Date.now() - startTime
    };
  }

  private async logCycleResult(result: TradingCycleResult): Promise<void> {
    logger.info(`📊 Cycle ${result.cycleId} completed in ${result.duration}ms`);
    logger.info(`🎯 Instructions: ${result.instructions.length}, Executed: ${result.executionResults.filter(r => r.success).length}`);

    if (result.error) {
      logger.error(`❌ Cycle error: ${result.error}`);
    }
  }
}