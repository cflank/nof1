/**
 * AI交易命令行接口
 * 支持启动AI驱动的自动交易
 */

import { Command } from 'commander';
import { logger } from '../utils/logger';
import { ConfigManager } from '../services/config-manager';
import { AITradingService, AITradingConfig } from '../services/ai-trading-service';
import { AIProviderManager, AIProviderType } from '../services/ai-providers';
import { getTemplate, listTemplates } from '../templates';

export interface AITradeOptions {
  provider: AIProviderType;
  template: string;
  interval: number;
  dryRun: boolean;
  maxTrades: number;
  maxExposure: number;
  confidence: number;
  pairs: string;
  consensus: boolean;
  providers?: string;
  threshold?: number;
}

export async function handleAITradeCommand(options: AITradeOptions): Promise<void> {
  try {
    logger.info('🤖 Initializing AI Trading System...');

    // 1. 验证和加载配置
    const config = await loadConfiguration(options);

    // 2. 创建AI交易服务
    const aiTradingService = new AITradingService(config);

    // 3. 启动服务
    await aiTradingService.start();

    // 4. 处理优雅关闭
    setupGracefulShutdown(aiTradingService);

    logger.info('✅ AI Trading System started successfully');

  } catch (error) {
    logger.error('❌ Failed to start AI Trading System:', error);
    process.exit(1);
  }
}

/**
 * 加载AI交易配置
 */
async function loadConfiguration(options: AITradeOptions): Promise<AITradingConfig> {
  const configManager = new ConfigManager();
  const providerManager = new AIProviderManager();

  // 加载环境配置
  const envConfig = configManager.loadFromEnvironment();

  // 验证AI提供商配置
  const aiProviderConfig = await loadAIProviderConfig(options.provider, envConfig);

  // 创建AI提供商
  const aiProvider = providerManager.createProvider(options.provider, aiProviderConfig);

  // 加载提示词模板
  const template = getTemplate(options.template);

  // 解析交易对
  const tradingPairs = options.pairs.split(',').map(pair => pair.trim().toUpperCase());

  // 构建完整配置
  const config: AITradingConfig = {
    // AI设置
    aiProvider,
    template,

    // 交易设置
    tradingPairs,
    maxPositions: 5,
    maxDailyTrades: options.maxTrades,

    // 风险管理
    maxPortfolioExposure: options.maxExposure,
    maxPositionSize: 1000, // 从环境变量读取
    minConfidenceThreshold: options.confidence,

    // 市场数据
    technicalIndicatorsEnabled: true,
    sentimentAnalysisEnabled: false,

    // 通知设置
    telegramEnabled: envConfig.TELEGRAM_ENABLED === 'true',

    // 其他设置
    dryRun: options.dryRun,
    intervalSeconds: options.interval
  };

  // 验证配置
  await validateConfiguration(config);

  return config;
}

/**
 * 加载AI提供商配置
 */
async function loadAIProviderConfig(provider: AIProviderType, envConfig: any): Promise<any> {
  switch (provider) {
    case 'openai':
      if (!envConfig.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
      }
      return {
        apiKey: envConfig.OPENAI_API_KEY,
        model: envConfig.OPENAI_MODEL || 'gpt-4-turbo',
        organizationId: envConfig.OPENAI_ORG_ID
      };

    case 'claude':
      if (!envConfig.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude provider');
      }
      return {
        apiKey: envConfig.ANTHROPIC_API_KEY,
        model: envConfig.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022'
      };

    case 'deepseek':
      if (!envConfig.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY environment variable is required for DeepSeek provider');
      }
      return {
        apiKey: envConfig.DEEPSEEK_API_KEY,
        model: envConfig.DEEPSEEK_MODEL || 'deepseek-chat',
        baseURL: envConfig.DEEPSEEK_BASE_URL
      };

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * 验证配置
 */
async function validateConfiguration(config: AITradingConfig): Promise<void> {
  logger.info('🔍 Validating AI trading configuration...');

  // 验证AI提供商连接
  if ('validateConnection' in config.aiProvider) {
    const isValid = await (config.aiProvider as any).validateConnection();
    if (!isValid) {
      throw new Error(`Failed to connect to ${config.aiProvider.name}`);
    }
    logger.info(`✅ ${config.aiProvider.name} connection validated`);
  }

  // 验证交易对
  if (config.tradingPairs.length === 0) {
    throw new Error('At least one trading pair must be specified');
  }

  const validPairs = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOGEUSDT', 'BNBUSDT'];
  for (const pair of config.tradingPairs) {
    if (!validPairs.includes(pair)) {
      logger.warn(`⚠️ Warning: ${pair} may not be supported`);
    }
  }

  // 验证风险参数
  if (config.maxPortfolioExposure <= 0 || config.maxPortfolioExposure > 100) {
    throw new Error('Max portfolio exposure must be between 1-100%');
  }

  if (config.minConfidenceThreshold < 0 || config.minConfidenceThreshold > 100) {
    throw new Error('Confidence threshold must be between 0-100');
  }

  logger.info('✅ Configuration validation completed');
}

/**
 * 设置优雅关闭
 */
function setupGracefulShutdown(aiTradingService: AITradingService): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`📡 Received ${signal}, shutting down gracefully...`);

      try {
        await aiTradingService.stop();
        logger.info('✅ AI Trading Service stopped successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });
  });
}

/**
 * 显示可用的AI提供商
 */
export function showAvailableProviders(): void {
  const providerManager = new AIProviderManager();
  const providers = providerManager.listProviders();

  console.log('\n🤖 Available AI Providers:\n');

  providers.forEach(provider => {
    const info = providerManager.getProviderInfo(provider as AIProviderType);
    console.log(`  ${info.name}`);
    console.log(`    Description: ${info.description}`);
    console.log(`    Cost per token: $${info.costPerToken}`);
    console.log(`    Rate limit: ${info.rateLimitPerMinute}/min`);
    console.log(`    Models: ${info.supportedModels.join(', ')}`);
    console.log(`    Features: ${info.features.join(', ')}`);
    console.log('');
  });
}

/**
 * 显示可用的模板
 */
export function showAvailableTemplates(): void {
  const templates = listTemplates();

  console.log('\n📋 Available Trading Templates:\n');

  templates.forEach(template => {
    console.log(`  ${template.name} (v${template.version})`);
    console.log(`    ${template.description}`);
    console.log('');
  });
}

/**
 * 测试AI提供商连接
 */
export async function testAIProvider(provider: AIProviderType): Promise<void> {
  try {
    logger.info(`🧪 Testing ${provider} connection...`);

    const configManager = new ConfigManager();
    const envConfig = configManager.loadFromEnvironment();
    const providerConfig = await loadAIProviderConfig(provider, envConfig);

    const providerManager = new AIProviderManager();
    const aiProvider = providerManager.createProvider(provider, providerConfig);

    // 发送测试请求
    const testPrompt = "Respond with: 'AI connection test successful'";
    const response = await aiProvider.requestDecision(testPrompt);

    logger.info(`✅ ${provider} test successful`);
    logger.info(`📊 Response: ${response.content.substring(0, 100)}...`);
    logger.info(`💰 Estimated cost: $${aiProvider.estimateCost(response.usage?.totalTokens || 0).toFixed(6)}`);

  } catch (error) {
    logger.error(`❌ ${provider} test failed:`, error);
    throw error;
  }
}

/**
 * 多提供商共识模式（实验性功能）
 */
export async function handleConsensusTrading(options: AITradeOptions): Promise<void> {
  if (!options.providers) {
    throw new Error('Multiple providers must be specified for consensus mode');
  }

  const providers = options.providers.split(',').map(p => p.trim() as AIProviderType);
  const threshold = options.threshold || 0.6;

  logger.info(`🤝 Starting consensus trading with ${providers.length} providers`);
  logger.info(`📊 Consensus threshold: ${(threshold * 100).toFixed(0)}%`);

  // TODO: 实现多提供商共识逻辑
  throw new Error('Consensus trading mode is not yet implemented');
}

/**
 * 注册AI交易命令
 */
export function registerAITradeCommands(program: Command): void {
  const aiTradeCommand = program
    .command('ai-trade')
    .description('Start AI-driven trading system')
    .option('--provider <provider>', 'AI provider (openai, claude, deepseek)', 'deepseek')
    .option('--template <template>', 'Trading strategy template', 'nof1-aggressive')
    .option('--interval <seconds>', 'Trading decision interval in seconds', '300')
    .option('--dry-run', 'Test mode - no actual trades', false)
    .option('--max-trades <number>', 'Maximum trades per day', '10')
    .option('--max-exposure <percent>', 'Maximum portfolio exposure %', '50')
    .option('--confidence <threshold>', 'Minimum confidence threshold', '70')
    .option('--pairs <pairs>', 'Trading pairs (comma-separated)', 'BTCUSDT,ETHUSDT')
    .option('--consensus', 'Use multiple AI providers for consensus', false)
    .option('--providers <providers>', 'Multiple providers for consensus (comma-separated)')
    .option('--threshold <number>', 'Consensus threshold (0.0-1.0)', '0.6')
    .action(async (options: AITradeOptions) => {
      if (options.consensus) {
        await handleConsensusTrading(options);
      } else {
        await handleAITradeCommand(options);
      }
    });

  // 子命令：列出可用的AI提供商
  program
    .command('ai-providers')
    .description('List available AI providers')
    .action(showAvailableProviders);

  // 子命令：列出可用的模板
  program
    .command('ai-templates')
    .description('List available trading templates')
    .action(showAvailableTemplates);

  // 子命令：测试AI提供商
  program
    .command('ai-test <provider>')
    .description('Test AI provider connection')
    .action(testAIProvider);
}