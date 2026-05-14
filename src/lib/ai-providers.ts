import { AIProvider } from './types';

export const PROVIDER_INFO: Record<AIProvider, {
  name: string;
  description: string;
  keyUrl: string;
  keyLabel: string;
  free: boolean;
  recommended: boolean;
}> = {
  gemini: {
    name: 'Google Gemini',
    description: 'Free with built-in Google Search for live law lookups.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'Get free API key',
    free: true,
    recommended: true,
  },
  groq: {
    name: 'Groq',
    description: 'Free tier available. Very fast inference.',
    keyUrl: 'https://console.groq.com/keys',
    keyLabel: 'Get free API key',
    free: true,
    recommended: false,
  },
  claude: {
    name: 'Anthropic Claude',
    description: 'Paid. Excellent reasoning and analysis.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Get API key',
    free: false,
    recommended: false,
  },
  openai: {
    name: 'OpenAI',
    description: 'Paid. Uses GPT-4o-mini.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'Get API key',
    free: false,
    recommended: false,
  },
};
