/**
 * AI服务提供商基类接口
 * 定义所有AI提供商必须实现的接口
 */

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  timestamp: number;
  provider: string;
  requestId?: string;
}

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  rateLimitPerMinute?: number;
  costPerToken?: number;
}

export interface RateLimitInfo {
  requestsPerMinute: number;
  tokensPerMinute: number;
  resetTime: number;
}

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;
  protected requestCount = 0;
  protected lastResetTime = Date.now();

  constructor(config: AIProviderConfig) {
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      rateLimitPerMinute: 60,
      costPerToken: 0.00002,
      ...config
    };
  }

  abstract get name(): string;
  abstract get supportedModels(): string[];
  abstract requestDecision(prompt: string): Promise<AIResponse>;

  /**
   * 检查是否达到速率限制
   */
  protected checkRateLimit(): boolean {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;

    // 每分钟重置计数
    if (timeSinceReset > 60000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    return this.requestCount < (this.config.rateLimitPerMinute || 60);
  }

  /**
   * 增加请求计数
   */
  protected incrementRequestCount(): void {
    this.requestCount++;
  }

  /**
   * 获取速率限制信息
   */
  getRateLimitInfo(): RateLimitInfo {
    const now = Date.now();
    const resetTime = this.lastResetTime + 60000;

    return {
      requestsPerMinute: this.requestCount,
      tokensPerMinute: 0, // 子类可以覆盖此值
      resetTime
    };
  }

  /**
   * 估算请求成本
   */
  estimateCost(tokenCount: number): number {
    return tokenCount * (this.config.costPerToken || 0);
  }

  /**
   * 验证API密钥格式
   */
  protected validateApiKey(): boolean {
    return !!(this.config.apiKey && this.config.apiKey.length > 10);
  }

  /**
   * 处理API错误
   */
  protected handleApiError(error: any): never {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error?.message || error.message;

      switch (status) {
        case 401:
          throw new Error(`Authentication failed: ${message}`);
        case 429:
          throw new Error(`Rate limit exceeded: ${message}`);
        case 500:
          throw new Error(`Provider server error: ${message}`);
        default:
          throw new Error(`API error (${status}): ${message}`);
      }
    }

    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - provider may be overloaded');
    }

    throw new Error(`Unknown error: ${error.message}`);
  }

  /**
   * 清理和验证提示词
   */
  protected cleanPrompt(prompt: string): string {
    return prompt
      .trim()
      .replace(/\s+/g, ' ') // 合并多个空格
      .substring(0, 50000); // 限制提示词长度
  }

  /**
   * 记录使用统计
   */
  protected logUsage(response: AIResponse): void {
    console.log(`[${this.name}] Used ${response.usage?.totalTokens || 0} tokens, ` +
      `estimated cost: $${this.estimateCost(response.usage?.totalTokens || 0).toFixed(4)}`);
  }
}