/**
 * 交易策略模板索引
 * 导出所有可用的AI交易提示词模板
 */

import { NOF1_AGGRESSIVE_TEMPLATE } from './nof1-aggressive';
import { CONSERVATIVE_TEMPLATE } from './conservative';
import { SCALPING_TEMPLATE } from './scalping';

export interface PromptTemplate {
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  marketDataPrompt: string;
  riskConstraints: string;
  outputFormat: string;
}

// 所有可用的交易模板
export const TRADING_TEMPLATES: Record<string, PromptTemplate> = {
  'nof1-aggressive': NOF1_AGGRESSIVE_TEMPLATE,
  'conservative': CONSERVATIVE_TEMPLATE,
  'scalping': SCALPING_TEMPLATE,
};

// 获取模板的辅助函数
export function getTemplate(name: string): PromptTemplate {
  const template = TRADING_TEMPLATES[name];
  if (!template) {
    throw new Error(`Template "${name}" not found. Available templates: ${Object.keys(TRADING_TEMPLATES).join(', ')}`);
  }
  return template;
}

// 列出所有可用模板
export function listTemplates(): Array<{name: string, description: string, version: string}> {
  return Object.values(TRADING_TEMPLATES).map(template => ({
    name: template.name,
    description: template.description,
    version: template.version
  }));
}

// 验证模板格式
export function validateTemplate(template: PromptTemplate): {isValid: boolean, errors: string[]} {
  const errors: string[] = [];

  if (!template.name) errors.push('Template name is required');
  if (!template.version) errors.push('Template version is required');
  if (!template.systemPrompt) errors.push('System prompt is required');
  if (!template.marketDataPrompt) errors.push('Market data prompt is required');
  if (!template.riskConstraints) errors.push('Risk constraints are required');
  if (!template.outputFormat) errors.push('Output format is required');

  // 检查必要的占位符
  const requiredPlaceholders = [
    'timestamp',
    'available_balance',
    'current_positions',
    'market_symbols'
  ];

  const promptText = template.systemPrompt + template.marketDataPrompt;

  for (const placeholder of requiredPlaceholders) {
    if (!promptText.includes(`{${placeholder}}`)) {
      errors.push(`Missing required placeholder: {${placeholder}}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// 默认模板配置
export const DEFAULT_TEMPLATE_CONFIG = {
  maxPositionSize: 1000, // USDT
  maxLeverage: 10,
  stopLossRequired: true,
  maxDailyTrades: 5,
  maxExposure: 50, // %
  minConfidence: 70, // %
  maxCorrelation: 80 // %
};

export * from './nof1-aggressive';
export * from './conservative';
export * from './scalping';