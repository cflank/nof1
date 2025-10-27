/**
 * OpenAI GPT-4 服务提供商适配器
 */

import axios, { AxiosInstance } from 'axios';
import { BaseAIProvider, AIResponse, AIProviderConfig } from './base-provider';
import { logger } from '../../utils/logger';

export interface OpenAIConfig extends AIProviderConfig {
  model?: 'gpt-4' | 'gpt-4-turbo' | 'gpt-4o' | 'gpt-3.5-turbo';
  organizationId?: string;
}

export class OpenAIProvider extends BaseAIProvider {
  private client: AxiosInstance;

  constructor(config: OpenAIConfig) {
    super({
      model: 'gpt-4-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      rateLimitPerMinute: 500,
      costPerToken: 0.00003, // GPT-4 pricing
      ...config
    });

    if (!this.validateApiKey()) {
      throw new Error('Valid OpenAI API key is required');
    }

    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      timeout: this.config.timeout,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(config.organizationId && { 'OpenAI-Organization': config.organizationId })
      }
    });
  }

  get name(): string {
    return 'OpenAI GPT-4';
  }

  get supportedModels(): string[] {
    return ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'];
  }

  async requestDecision(prompt: string): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedPrompt = this.cleanPrompt(prompt);

      logger.info(`[OpenAI] Requesting trading decision with ${cleanedPrompt.length} characters`);

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
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
          totalTokens: response.data.usage.total_tokens
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      logger.info(`[OpenAI] Received response: ${aiResponse.content.substring(0, 100)}...`);

      return aiResponse;

    } catch (error) {
      logger.error(`[OpenAI] Request failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 获取模型列表
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/models');
      return response.data.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id);
    } catch (error) {
      logger.error('[OpenAI] Failed to fetch models:', error);
      return this.supportedModels;
    }
  }

  /**
   * 验证API连接
   */
  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/models');
      return response.status === 200;
    } catch (error) {
      logger.error('[OpenAI] Connection validation failed:', error);
      return false;
    }
  }

  /**
   * 获取账户使用情况
   */
  async getUsage(): Promise<any> {
    try {
      // OpenAI doesn't provide usage endpoint in the same way
      // This would need to be implemented based on their billing API
      return {
        provider: this.name,
        rateLimitInfo: this.getRateLimitInfo()
      };
    } catch (error) {
      logger.error('[OpenAI] Failed to get usage:', error);
      return null;
    }
  }

  /**
   * 流式响应支持（未来功能）
   */
  async requestDecisionStream(prompt: string): Promise<AsyncIterable<string>> {
    // 实现流式响应以获得更快的交互体验
    throw new Error('Streaming not yet implemented for OpenAI provider');
  }

  /**
   * 批量请求支持
   */
  async requestMultipleDecisions(prompts: string[]): Promise<AIResponse[]> {
    const responses: AIResponse[] = [];

    for (const prompt of prompts) {
      try {
        const response = await this.requestDecision(prompt);
        responses.push(response);

        // 添加延迟以避免速率限制
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`[OpenAI] Failed to process prompt: ${prompt.substring(0, 50)}...`, error);
        // 继续处理其他提示词
      }
    }

    return responses;
  }
}