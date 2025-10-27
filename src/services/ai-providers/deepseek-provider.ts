/**
 * DeepSeek 服务提供商适配器
 */

import axios, { AxiosInstance } from 'axios';
import { BaseAIProvider, AIResponse, AIProviderConfig } from './base-provider';
import { logger } from '../../utils/logger';

export interface DeepSeekConfig extends AIProviderConfig {
  model?: 'deepseek-chat' | 'deepseek-coder';
  baseURL?: string;
}

export class DeepSeekProvider extends BaseAIProvider {
  private client: AxiosInstance;

  constructor(config: DeepSeekConfig) {
    super({
      model: 'deepseek-chat',
      temperature: 0.8,
      maxTokens: 2000,
      timeout: 30000,
      rateLimitPerMinute: 120,
      costPerToken: 0.000001, // DeepSeek非常便宜
      ...config
    });

    if (!this.validateApiKey()) {
      throw new Error('Valid DeepSeek API key is required');
    }

    const baseURL = config.baseURL || 'https://api.deepseek.com/v1';

    this.client = axios.create({
      baseURL,
      timeout: this.config.timeout,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  get name(): string {
    return 'DeepSeek Chat';
  }

  get supportedModels(): string[] {
    return ['deepseek-chat', 'deepseek-coder'];
  }

  async requestDecision(prompt: string): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedPrompt = this.cleanPrompt(prompt);

      logger.info(`[DeepSeek] Requesting trading decision with ${cleanedPrompt.length} characters`);

      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: cleanedPrompt
          }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false
      });

      const aiResponse: AIResponse = {
        content: response.data.choices[0].message.content,
        usage: {
          promptTokens: response.data.usage?.prompt_tokens || 0,
          completionTokens: response.data.usage?.completion_tokens || 0,
          totalTokens: response.data.usage?.total_tokens || 0
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      logger.info(`[DeepSeek] Received response: ${aiResponse.content.substring(0, 100)}...`);

      return aiResponse;

    } catch (error) {
      logger.error(`[DeepSeek] Request failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 验证API连接
   */
  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        max_tokens: 10
      });
      return response.status === 200;
    } catch (error) {
      logger.error('[DeepSeek] Connection validation failed:', error);
      return false;
    }
  }

  /**
   * 获取使用统计
   */
  async getUsage(): Promise<any> {
    try {
      return {
        provider: this.name,
        rateLimitInfo: this.getRateLimitInfo(),
        estimatedCostPerRequest: this.estimateCost(2000), // 平均token数
        note: 'DeepSeek is extremely cost-effective for high-frequency trading decisions'
      };
    } catch (error) {
      logger.error('[DeepSeek] Failed to get usage:', error);
      return null;
    }
  }

  /**
   * 支持系统消息的请求
   */
  async requestDecisionWithSystem(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedSystemPrompt = this.cleanPrompt(systemPrompt);
      const cleanedUserPrompt = this.cleanPrompt(userPrompt);

      logger.info(`[DeepSeek] Requesting trading decision with system prompt (${cleanedSystemPrompt.length} chars) and user prompt (${cleanedUserPrompt.length} chars)`);

      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: cleanedSystemPrompt
          },
          {
            role: 'user',
            content: cleanedUserPrompt
          }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false
      });

      const aiResponse: AIResponse = {
        content: response.data.choices[0].message.content,
        usage: {
          promptTokens: response.data.usage?.prompt_tokens || 0,
          completionTokens: response.data.usage?.completion_tokens || 0,
          totalTokens: response.data.usage?.total_tokens || 0
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      return aiResponse;

    } catch (error) {
      logger.error(`[DeepSeek] Request with system prompt failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 高频交易优化的快速请求
   */
  async requestQuickDecision(prompt: string): Promise<AIResponse> {
    const quickConfig = {
      ...this.config,
      maxTokens: 500, // 更少的token以获得更快响应
      temperature: 0.9 // 稍高的随机性
    };

    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedPrompt = this.cleanPrompt(prompt);

      logger.info(`[DeepSeek] Quick trading decision request with ${cleanedPrompt.length} characters`);

      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: cleanedPrompt
          }
        ],
        temperature: quickConfig.temperature,
        max_tokens: quickConfig.maxTokens,
        stream: false
      });

      const aiResponse: AIResponse = {
        content: response.data.choices[0].message.content,
        usage: {
          promptTokens: response.data.usage?.prompt_tokens || 0,
          completionTokens: response.data.usage?.completion_tokens || 0,
          totalTokens: response.data.usage?.total_tokens || 0
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      return aiResponse;

    } catch (error) {
      logger.error(`[DeepSeek] Quick request failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 批量处理支持（利用DeepSeek的高速率限制）
   */
  async requestMultipleDecisions(prompts: string[]): Promise<AIResponse[]> {
    const responses: AIResponse[] = [];
    const concurrentRequests = 3; // DeepSeek支持更高的并发

    // 分批处理以避免过载
    for (let i = 0; i < prompts.length; i += concurrentRequests) {
      const batch = prompts.slice(i, i + concurrentRequests);

      const batchPromises = batch.map(prompt =>
        this.requestDecision(prompt).catch(error => {
          logger.error(`[DeepSeek] Batch request failed for prompt: ${prompt.substring(0, 50)}...`, error);
          return null;
        })
      );

      const batchResults = await Promise.all(batchPromises);

      responses.push(...batchResults.filter(result => result !== null) as AIResponse[]);

      // 短暂延迟以避免速率限制
      if (i + concurrentRequests < prompts.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return responses;
  }

  /**
   * 流式响应支持（如果DeepSeek支持）
   */
  async requestDecisionStream(prompt: string): Promise<AsyncIterable<string>> {
    // 实现流式响应
    throw new Error('Streaming support for DeepSeek needs to be implemented based on their API capabilities');
  }

  /**
   * 特殊的交易分析模式
   */
  async requestTradingAnalysis(marketData: any, strategy: string): Promise<AIResponse> {
    const tradingPrompt = `
As a professional cryptocurrency trader, analyze the following market data and provide trading recommendations using the ${strategy} strategy:

Market Data:
${JSON.stringify(marketData, null, 2)}

Please provide:
1. Market sentiment analysis
2. Technical analysis findings
3. Specific trading recommendations
4. Risk assessment
5. Position sizing suggestions

Format your response with clear TRADE_DECISION blocks as specified in the trading template.
`;

    return this.requestDecision(tradingPrompt);
  }
}