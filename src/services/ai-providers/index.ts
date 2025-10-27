/**
 * AI服务提供商索引
 * 统一导出所有AI提供商适配器
 */

export * from './base-provider';
export * from './openai-provider';
export * from './claude-provider';
export * from './deepseek-provider';

import { OpenAIProvider, OpenAIConfig } from './openai-provider';
import { ClaudeProvider, ClaudeConfig } from './claude-provider';
import { DeepSeekProvider, DeepSeekConfig } from './deepseek-provider';
import { BaseAIProvider, AIProviderConfig } from './base-provider';

export type AIProviderType = 'openai' | 'claude' | 'deepseek';

export interface AIProviderFactory {
  createProvider(type: AIProviderType, config: AIProviderConfig): BaseAIProvider;
  listProviders(): string[];
  getProviderInfo(type: AIProviderType): ProviderInfo;
}

export interface ProviderInfo {
  name: string;
  description: string;
  costPerToken: number;
  rateLimitPerMinute: number;
  supportedModels: string[];
  features: string[];
}

/**
 * AI提供商工厂类
 */
export class AIProviderManager implements AIProviderFactory {

  createProvider(type: AIProviderType, config: AIProviderConfig): BaseAIProvider {
    switch (type) {
      case 'openai':
        return new OpenAIProvider(config as OpenAIConfig);
      case 'claude':
        return new ClaudeProvider(config as ClaudeConfig);
      case 'deepseek':
        return new DeepSeekProvider(config as DeepSeekConfig);
      default:
        throw new Error(`Unknown AI provider type: ${type}`);
    }
  }

  listProviders(): string[] {
    return ['openai', 'claude', 'deepseek'];
  }

  getProviderInfo(type: AIProviderType): ProviderInfo {
    const providerInfoMap: Record<AIProviderType, ProviderInfo> = {
      openai: {
        name: 'OpenAI GPT-4',
        description: 'Advanced reasoning and analysis capabilities, excellent for complex trading strategies',
        costPerToken: 0.00003,
        rateLimitPerMinute: 500,
        supportedModels: ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'],
        features: ['High reasoning quality', 'Function calling', 'Large context window', 'Reliable output format']
      },
      claude: {
        name: 'Anthropic Claude',
        description: 'Excellent analytical capabilities with strong safety measures and nuanced reasoning',
        costPerToken: 0.000015,
        rateLimitPerMinute: 60,
        supportedModels: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
        features: ['Superior reasoning', 'System messages', 'Safety-focused', 'Excellent at analysis']
      },
      deepseek: {
        name: 'DeepSeek Chat',
        description: 'Cost-effective solution with good performance for high-frequency trading decisions',
        costPerToken: 0.000001,
        rateLimitPerMinute: 120,
        supportedModels: ['deepseek-chat', 'deepseek-coder'],
        features: ['Very low cost', 'High rate limits', 'Good for automation', 'Fast responses']
      }
    };

    return providerInfoMap[type];
  }

  /**
   * 根据使用场景推荐最佳提供商
   */
  recommendProvider(scenario: 'high-frequency' | 'analysis' | 'cost-effective' | 'reliable'): AIProviderType {
    const recommendations: Record<string, AIProviderType> = {
      'high-frequency': 'deepseek', // 高频交易 - 速度和成本优先
      'analysis': 'claude',          // 深度分析 - 质量优先
      'cost-effective': 'deepseek',  // 成本效益 - 价格优先
      'reliable': 'openai'           // 可靠性 - 稳定性优先
    };

    return recommendations[scenario] || 'openai';
  }

  /**
   * 验证所有提供商的连接
   */
  async validateAllProviders(configs: Record<AIProviderType, AIProviderConfig>): Promise<Record<AIProviderType, boolean>> {
    const results: Record<AIProviderType, boolean> = {} as any;

    for (const [type, config] of Object.entries(configs) as [AIProviderType, AIProviderConfig][]) {
      try {
        const provider = this.createProvider(type, config);
        if ('validateConnection' in provider) {
          results[type] = await (provider as any).validateConnection();
        } else {
          results[type] = true; // 假设连接正常
        }
      } catch (error) {
        console.error(`Failed to validate ${type} provider:`, error);
        results[type] = false;
      }
    }

    return results;
  }

  /**
   * 获取所有提供商的使用统计
   */
  async getAllUsageStats(providers: BaseAIProvider[]): Promise<any[]> {
    const stats = [];

    for (const provider of providers) {
      try {
        if ('getUsage' in provider) {
          const usage = await (provider as any).getUsage();
          stats.push({
            provider: provider.name,
            ...usage
          });
        }
      } catch (error) {
        console.error(`Failed to get usage for ${provider.name}:`, error);
      }
    }

    return stats;
  }
}

/**
 * 多提供商投票机制
 */
export class MultiProviderConsensus {
  private providers: BaseAIProvider[];

  constructor(providers: BaseAIProvider[]) {
    this.providers = providers;
  }

  /**
   * 获取多个AI提供商的共识决策
   */
  async getConsensusDecision(prompt: string, threshold: number = 0.6): Promise<{
    consensus: boolean;
    decisions: Array<{provider: string, decision: string, confidence: number}>;
    finalDecision?: string;
  }> {
    const decisions = [];

    // 并行获取所有提供商的决策
    const responses = await Promise.allSettled(
      this.providers.map(provider => provider.requestDecision(prompt))
    );

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      if (response.status === 'fulfilled') {
        decisions.push({
          provider: this.providers[i].name,
          decision: response.value.content,
          confidence: this.extractConfidence(response.value.content)
        });
      }
    }

    // 分析共识
    const agreementLevel = this.calculateAgreement(decisions);
    const hasConsensus = agreementLevel >= threshold;

    return {
      consensus: hasConsensus,
      decisions,
      finalDecision: hasConsensus ? this.getFinalDecision(decisions) : undefined
    };
  }

  private extractConfidence(content: string): number {
    const match = content.match(/confidence:\s*(\d+)/i);
    return match ? parseInt(match[1]) : 50;
  }

  private calculateAgreement(decisions: any[]): number {
    if (decisions.length < 2) return 1;

    // 简单的共识算法 - 基于相似的行动建议
    const actions = decisions.map(d => this.extractAction(d.decision));
    const actionCounts = actions.reduce((acc, action) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const maxCount = Math.max(...Object.values(actionCounts));
    return maxCount / decisions.length;
  }

  private extractAction(content: string): string {
    const match = content.match(/action:\s*(buy|sell|hold|close)/i);
    return match ? match[1].toUpperCase() : 'HOLD';
  }

  private getFinalDecision(decisions: any[]): string {
    // 选择置信度最高的决策作为最终决策
    return decisions.reduce((prev, current) =>
      prev.confidence > current.confidence ? prev : current
    ).decision;
  }
}

// 默认导出
export default AIProviderManager;