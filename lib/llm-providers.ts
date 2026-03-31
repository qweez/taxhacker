export const PROVIDERS = [
  {
    key: "openai",
    label: "OpenAI",
    apiKeyName: "openai_api_key",
    modelName: "openai_model_name",
    defaultModelName: "gpt-4o-mini",
    apiDoc: "https://platform.openai.com/settings/organization/api-keys",
    apiDocLabel: "OpenAI Platform Console",
    placeholder: "sk-...",
    help: {
      url: "https://platform.openai.com/settings/organization/api-keys",
      label: "OpenAI Platform Console"
    },
    logo: "/logo/openai.svg"
  },
  {
    key: "google",
    label: "Google",
    apiKeyName: "google_api_key",
    modelName: "google_model_name",
    defaultModelName: "gemini-2.5-flash",
    apiDoc: "https://aistudio.google.com/apikey",
    apiDocLabel: "Google AI Studio",
    placeholder: "...",
    help: {
      url: "https://aistudio.google.com/apikey",
      label: "Google AI Studio"
    },
    logo: "/logo/google.svg"
  },
  {
    key: "anthropic",
    label: "Anthropic (Claude)",
    apiKeyName: "anthropic_api_key",
    modelName: "anthropic_model_name",
    defaultModelName: "claude-sonnet-4-20250514",
    apiDoc: "https://console.anthropic.com/settings/keys",
    apiDocLabel: "Anthropic Console",
    placeholder: "sk-ant-...",
    help: {
      url: "https://console.anthropic.com/settings/keys",
      label: "Anthropic Console"
    },
    logo: "/logo/anthropic.svg"
  },
  {
    key: "mistral",
    label: "Mistral",
    apiKeyName: "mistral_api_key",
    modelName: "mistral_model_name",
    defaultModelName: "mistral-medium-latest",
    apiDoc: "https://admin.mistral.ai/organization/api-keys",
    apiDocLabel: "Mistral Admin Console",
    placeholder: "...",
    help: {
      url: "https://admin.mistral.ai/organization/api-keys",
      label: "Mistral Admin Console"
    },
    logo: "/logo/mistral.svg"
  },
  {
    key: "xai",
    label: "xAI (Grok)",
    apiKeyName: "xai_api_key",
    modelName: "xai_model_name",
    defaultModelName: "grok-3",
    apiDoc: "https://console.x.ai",
    apiDocLabel: "xAI Console",
    placeholder: "xai-...",
    help: {
      url: "https://console.x.ai",
      label: "xAI Console"
    },
    logo: "/logo/xai.svg"
  },
  {
    key: "claude-code",
    label: "Claude Code (CLI)",
    apiKeyName: "claude_code_path",
    modelName: "claude_code_model",
    defaultModelName: "claude-opus-4-6",
    apiDoc: "https://docs.anthropic.com/en/docs/claude-code",
    apiDocLabel: "Claude Code Docs",
    placeholder: "/usr/bin/claude",
    help: {
      url: "https://docs.anthropic.com/en/docs/claude-code",
      label: "Claude Code Documentation"
    },
    logo: "/logo/anthropic.svg"
  },
  {
    key: "ollama",
    label: "Ollama (Local)",
    apiKeyName: "ollama_base_url",
    modelName: "ollama_model_name",
    defaultModelName: "qwen2.5vl:7b",
    apiDoc: "https://ollama.com/library",
    apiDocLabel: "Ollama Model Library",
    placeholder: "http://localhost:11434",
    help: {
      url: "https://ollama.com",
      label: "Ollama Documentation"
    },
    logo: "/logo/ollama.svg"
  },
]
