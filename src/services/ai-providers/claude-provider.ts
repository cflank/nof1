/**
 * Anthropic Claude 服务提供商适配器
 */

import axios, { AxiosInstance } from 'axios';
import { BaseAIProvider, AIResponse, AIProviderConfig } from './base-provider';
import { logger } from '../../utils/logger';

export interface ClaudeConfig extends AIProviderConfig {
  model?: 'claude-3-5-sonnet-20241022' | 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-3-haiku-20240307';
  version?: string;
}

export class ClaudeProvider extends BaseAIProvider {
  private client: AxiosInstance;

  constructor(config: ClaudeConfig) {
    super({
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      rateLimitPerMinute: 60,
      costPerToken: 0.000015, // Claude 3.5 Sonnet pricing
      ...config
    });

    if (!this.validateApiKey()) {
      throw new Error('Valid Anthropic API key is required');
    }

    this.client = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      timeout: this.config.timeout,
      headers: {
        'x-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': config.version || '2023-06-01'
      }
    });
  }

  get name(): string {
    return 'Anthropic Claude';
  }

  get supportedModels(): string[] {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ];
  }

  async requestDecision(prompt: string): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedPrompt = this.cleanPrompt(prompt);

      logger.info(`[Claude] Requesting trading decision with ${cleanedPrompt.length} characters`);

      const response = await this.client.post('/messages', {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: cleanedPrompt
          }
        ]
      });

      const aiResponse: AIResponse = {
        content: response.data.content[0].text,
        usage: {
          promptTokens: response.data.usage.input_tokens,
          completionTokens: response.data.usage.output_tokens,
          totalTokens: response.data.usage.input_tokens + response.data.usage.output_tokens
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      logger.info(`[Claude] Received response: ${aiResponse.content.substring(0, 100)}...`);

      return aiResponse;

    } catch (error) {
      logger.error(`[Claude] Request failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 验证API连接
   */
  async validateConnection(): Promise<boolean> {
    try {
      // Claude没有专门的健康检查端点，我们发送一个简单的测试请求
      const response = await this.client.post('/messages', {
        model: this.config.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      });
      return response.status === 200;
    } catch (error) {
      logger.error('[Claude] Connection validation failed:', error);
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
        note: 'Claude API does not provide usage statistics endpoint'
      };
    } catch (error) {
      logger.error('[Claude] Failed to get usage:', error);
      return null;
    }
  }

  /**
   * Claude特有的系统消息支持
   */
  async requestDecisionWithSystem(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();
      const cleanedSystemPrompt = this.cleanPrompt(systemPrompt);
      const cleanedUserPrompt = this.cleanPrompt(userPrompt);

      logger.info(`[Claude] Requesting trading decision with system prompt (${cleanedSystemPrompt.length} chars) and user prompt (${cleanedUserPrompt.length} chars)`);

      const response = await this.client.post('/messages', {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: cleanedSystemPrompt,
        messages: [
          {
            role: 'user',
            content: cleanedUserPrompt
          }
        ]
      });

      const aiResponse: AIResponse = {
        content: response.data.content[0].text,
        usage: {
          promptTokens: response.data.usage.input_tokens,
          completionTokens: response.data.usage.output_tokens,
          totalTokens: response.data.usage.input_tokens + response.data.usage.output_tokens
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      logger.info(`[Claude] Received response: ${aiResponse.content.substring(0, 100)}...`);

      return aiResponse;

    } catch (error) {
      logger.error(`[Claude] Request with system prompt failed:`, error);
      this.handleApiError(error);
    }
  }

  /**
   * 批量处理支持
   */
  async requestMultipleDecisions(prompts: string[]): Promise<AIResponse[]> {
    const responses: AIResponse[] = [];

    for (const prompt of prompts) {
      try {
        const response = await this.requestDecision(prompt);
        responses.push(response);

        // Claude有较严格的速率限制，添加更长的延迟
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`[Claude] Failed to process prompt: ${prompt.substring(0, 50)}...`, error);
        // 继续处理其他提示词
      }
    }

    return responses;
  }

  /**
   * 对话历史支持
   */
  async requestDecisionWithHistory(messages: Array<{role: 'user' | 'assistant', content: string}>): Promise<AIResponse> {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    try {
      this.incrementRequestCount();

      logger.info(`[Claude] Requesting trading decision with ${messages.length} messages in history`);

      const response = await this.client.post('/messages', {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: messages.map(msg => ({
          role: msg.role,
          content: this.cleanPrompt(msg.content)
        }))
      });

      const aiResponse: AIResponse = {
        content: response.data.content[0].text,
        usage: {
          promptTokens: response.data.usage.input_tokens,
          completionTokens: response.data.usage.output_tokens,
          totalTokens: response.data.usage.input_tokens + response.data.usage.output_tokens
        },
        model: response.data.model,
        timestamp: Date.now(),
        provider: this.name,
        requestId: response.data.id
      };

      this.logUsage(aiResponse);
      return aiResponse;

    } catch (error) {
      logger.error(`[Claude] Request with history failed:`, error);
      this.handleApiError(error);
    }
  }
}