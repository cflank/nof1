/**
 * AI指令解析器
 * 将AI的文本回复解析为结构化的交易指令
 */

import { logger } from '../utils/logger';

export interface TradingInstruction {
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
  riskReward?: string;
  maxHoldTime?: string;
  timestamp: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParseResult {
  instructions: TradingInstruction[];
  rawResponse: string;
  parseErrors: string[];
  validInstructions: TradingInstruction[];
  invalidInstructions: Array<{instruction: Partial<TradingInstruction>, errors: string[]}>;
}

export class AIInstructionParser {

  /**
   * 解析AI回复并提取交易指令
   */
  parseAIResponse(response: string): ParseResult {
    const timestamp = Date.now();
    const parseErrors: string[] = [];
    const instructions: TradingInstruction[] = [];
    const invalidInstructions: Array<{instruction: Partial<TradingInstruction>, errors: string[]}> = [];

    try {
      // 清理响应文本
      const cleanedResponse = this.cleanResponse(response);

      // 查找TRADE_DECISION块
      const tradeBlocks = this.extractTradeBlocks(cleanedResponse);

      if (tradeBlocks.length === 0) {
        parseErrors.push("No TRADE_DECISION blocks found in AI response");
        // 尝试解析非结构化响应
        const fallbackInstruction = this.parseFallbackResponse(cleanedResponse, timestamp);
        if (fallbackInstruction) {
          instructions.push(fallbackInstruction);
        }
      } else {
        // 解析每个交易块
        for (let i = 0; i < tradeBlocks.length; i++) {
          try {
            const instruction = this.parseTradeBlock(tradeBlocks[i], timestamp);
            if (instruction) {
              instructions.push(instruction);
            }
          } catch (error) {
            parseErrors.push(`Error parsing trade block ${i + 1}: ${error.message}`);
          }
        }
      }

      // 验证所有指令
      const validInstructions: TradingInstruction[] = [];

      for (const instruction of instructions) {
        const validation = this.validateInstruction(instruction);
        if (validation.isValid) {
          validInstructions.push(instruction);
        } else {
          invalidInstructions.push({
            instruction,
            errors: validation.errors
          });
          logger.warn(`Invalid instruction for ${instruction.symbol}: ${validation.errors.join(', ')}`);
        }
      }

      return {
        instructions,
        rawResponse: response,
        parseErrors,
        validInstructions,
        invalidInstructions
      };

    } catch (error) {
      parseErrors.push(`Critical parsing error: ${error.message}`);
      return {
        instructions: [],
        rawResponse: response,
        parseErrors,
        validInstructions: [],
        invalidInstructions: []
      };
    }
  }

  /**
   * 清理AI响应文本
   */
  private cleanResponse(response: string): string {
    return response
      .replace(/```[\s\S]*?```/g, '') // 移除代码块
      .replace(/\*\*/g, '') // 移除markdown粗体
      .replace(/\*/g, '') // 移除markdown斜体
      .replace(/#{1,6}\s/g, '') // 移除markdown标题
      .trim();
  }

  /**
   * 提取TRADE_DECISION块
   */
  private extractTradeBlocks(response: string): string[] {
    // 匹配TRADE_DECISION:开始到---结束或下一个TRADE_DECISION:
    const pattern = /TRADE_DECISION:\s*([\s\S]*?)(?=TRADE_DECISION:|---|$)/gi;
    const matches = response.match(pattern);

    if (!matches) {
      // 尝试更宽松的匹配
      const looserPattern = /(?:TRADE|DECISION|ACTION)[\s:]+[\s\S]*?(?=(?:TRADE|DECISION|ACTION)[\s:]|$)/gi;
      return response.match(looserPattern) || [];
    }

    return matches.map(match => match.replace(/^TRADE_DECISION:\s*/i, '').trim());
  }

  /**
   * 解析单个交易块
   */
  private parseTradeBlock(block: string, timestamp: number): TradingInstruction | null {
    const lines = block.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const instruction: Partial<TradingInstruction> = { timestamp };

    for (const line of lines) {
      if (line.includes('---')) break; // 结束标记

      const [key, ...valueParts] = line.split(':');
      if (valueParts.length === 0) continue;

      const value = valueParts.join(':').trim();
      const lowerKey = key.toLowerCase().trim();

      switch (lowerKey) {
        case 'action':
          instruction.action = this.parseAction(value);
          break;
        case 'symbol':
          instruction.symbol = this.parseSymbol(value);
          break;
        case 'quantity':
          instruction.quantity = this.parseNumber(value);
          break;
        case 'leverage':
          instruction.leverage = this.parseNumber(value);
          break;
        case 'entry price':
        case 'price':
          instruction.price = this.parsePrice(value);
          break;
        case 'stop loss':
        case 'stoploss':
          instruction.stopLoss = this.parseNumber(value);
          break;
        case 'take profit':
        case 'takeprofit':
          instruction.takeProfit = this.parseNumber(value);
          break;
        case 'confidence':
          instruction.confidence = this.parseNumber(value) || 0;
          break;
        case 'priority':
          instruction.priority = this.parsePriority(value);
          break;
        case 'reason':
          instruction.reason = value;
          break;
        case 'risk reward':
        case 'riskreward':
          instruction.riskReward = value;
          break;
        case 'max hold time':
        case 'maxholdtime':
          instruction.maxHoldTime = value;
          break;
      }
    }

    // 验证必填字段
    if (!instruction.action || !instruction.symbol) {
      return null;
    }

    // 为HOLD操作设置默认值
    if (instruction.action === 'HOLD') {
      return {
        action: 'HOLD',
        symbol: instruction.symbol || 'ALL',
        reason: instruction.reason || 'AI recommends holding current positions',
        confidence: instruction.confidence || 50,
        priority: instruction.priority || 'LOW',
        timestamp
      };
    }

    return instruction as TradingInstruction;
  }

  /**
   * 解析动作类型
   */
  private parseAction(value: string): TradingInstruction['action'] | undefined {
    const action = value.toUpperCase().trim();

    const actionMap: Record<string, TradingInstruction['action']> = {
      'BUY': 'BUY',
      'LONG': 'BUY',
      'SELL': 'SELL',
      'SHORT': 'SELL',
      'CLOSE': 'CLOSE',
      'EXIT': 'CLOSE',
      'HOLD': 'HOLD',
      'WAIT': 'HOLD',
      'SET_STOP_LOSS': 'SET_STOP_LOSS',
      'SET_TAKE_PROFIT': 'SET_TAKE_PROFIT'
    };

    return actionMap[action];
  }

  /**
   * 解析交易对符号
   */
  private parseSymbol(value: string): string {
    let symbol = value.toUpperCase().trim();

    // 添加USDT后缀（如果没有）
    if (!symbol.includes('USDT') && !symbol.includes('BUSD')) {
      symbol = symbol + 'USDT';
    }

    // 移除可能的前缀
    symbol = symbol.replace(/^(FUTURES?|SPOT)_?/i, '');

    return symbol;
  }

  /**
   * 解析数字值
   */
  private parseNumber(value: string): number | undefined {
    // 移除非数字字符（除了小数点和负号）
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleaned);

    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * 解析价格（支持MARKET关键字）
   */
  private parsePrice(value: string): number | undefined {
    if (value.toUpperCase().includes('MARKET')) {
      return undefined; // MARKET orders don't need price
    }
    return this.parseNumber(value);
  }

  /**
   * 解析优先级
   */
  private parsePriority(value: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const priority = value.toUpperCase().trim();

    if (['HIGH', 'URGENT', 'CRITICAL'].includes(priority)) return 'HIGH';
    if (['MEDIUM', 'NORMAL', 'MODERATE'].includes(priority)) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * 解析非结构化响应（后备方案）
   */
  private parseFallbackResponse(response: string, timestamp: number): TradingInstruction | null {
    const lowerResponse = response.toLowerCase();

    // 检查是否包含交易相关关键词
    if (lowerResponse.includes('hold') || lowerResponse.includes('wait') || lowerResponse.includes('no trade')) {
      return {
        action: 'HOLD',
        symbol: 'ALL',
        reason: 'AI recommends holding based on current market conditions',
        confidence: 50,
        priority: 'LOW',
        timestamp
      };
    }

    // 尝试识别买卖信号
    let action: TradingInstruction['action'] | undefined;
    let symbol = '';

    if (lowerResponse.includes('buy') || lowerResponse.includes('long')) {
      action = 'BUY';
    } else if (lowerResponse.includes('sell') || lowerResponse.includes('short')) {
      action = 'SELL';
    }

    // 尝试提取交易对
    const symbolMatch = response.match(/([A-Z]{2,10}(?:USDT|BUSD))/);
    if (symbolMatch) {
      symbol = symbolMatch[1];
    }

    if (action && symbol) {
      return {
        action,
        symbol,
        reason: 'Parsed from unstructured AI response',
        confidence: 30, // 较低的置信度
        priority: 'LOW',
        timestamp
      };
    }

    return null;
  }

  /**
   * 验证交易指令
   */
  validateInstruction(instruction: TradingInstruction): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 基本字段验证
    if (!instruction.action) {
      errors.push("Action is required");
    }

    if (!instruction.symbol) {
      errors.push("Symbol is required");
    }

    if (!instruction.reason) {
      warnings.push("No reason provided for trading decision");
    }

    // 动作特定验证
    if (instruction.action !== 'HOLD' && instruction.action !== 'CLOSE') {
      if (!instruction.quantity && !instruction.price) {
        errors.push("Either quantity or price must be specified for trading actions");
      }

      if (instruction.leverage && (instruction.leverage < 1 || instruction.leverage > 50)) {
        errors.push("Leverage must be between 1 and 50");
      }

      if (instruction.action === 'BUY' || instruction.action === 'SELL') {
        if (!instruction.stopLoss) {
          warnings.push("No stop loss specified - high risk");
        }

        if (!instruction.takeProfit) {
          warnings.push("No take profit specified - consider setting exit strategy");
        }
      }
    }

    // 置信度验证
    if (instruction.confidence < 0 || instruction.confidence > 100) {
      errors.push("Confidence must be between 0 and 100");
    }

    if (instruction.confidence < 50) {
      warnings.push("Low confidence level - consider skipping this trade");
    }

    // 交易对验证
    if (instruction.symbol && !this.isValidSymbol(instruction.symbol)) {
      errors.push(`Invalid trading symbol: ${instruction.symbol}`);
    }

    // 风险回报比验证
    if (instruction.riskReward) {
      const rrMatch = instruction.riskReward.match(/1:(\d+\.?\d*)/);
      if (rrMatch) {
        const ratio = parseFloat(rrMatch[1]);
        if (ratio < 1.5) {
          warnings.push("Risk/reward ratio is less than 1:1.5 - consider better opportunities");
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证交易对是否有效
   */
  private isValidSymbol(symbol: string): boolean {
    // 支持的交易对列表（可以从Binance API动态获取）
    const validSymbols = [
      'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOGEUSDT', 'BNBUSDT',
      'XRPUSDT', 'SOLUSDT', 'MATICUSDT', 'DOTUSDT', 'AVAXUSDT',
      'LTCUSDT', 'LINKUSDT', 'UNIUSDT', 'ATOMUSDT', 'FILUSDT',
      'TRXUSDT', 'ETCUSDT', 'XLMUSDT', 'VETUSDT', 'ICPUSDT'
    ];

    return validSymbols.includes(symbol.toUpperCase());
  }

  /**
   * 获取解析统计信息
   */
  getParsingStats(result: ParseResult): {
    totalInstructions: number;
    validInstructions: number;
    invalidInstructions: number;
    parseErrors: number;
    successRate: number;
  } {
    const totalInstructions = result.instructions.length;
    const validInstructions = result.validInstructions.length;
    const invalidInstructions = result.invalidInstructions.length;
    const parseErrors = result.parseErrors.length;

    return {
      totalInstructions,
      validInstructions,
      invalidInstructions,
      parseErrors,
      successRate: totalInstructions > 0 ? (validInstructions / totalInstructions) * 100 : 0
    };
  }
}