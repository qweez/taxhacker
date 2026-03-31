import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatMistralAI } from "@langchain/mistralai"
import { BaseMessage, HumanMessage } from "@langchain/core/messages"
import Anthropic from "@anthropic-ai/sdk"

export type LLMProvider = "openai" | "google" | "mistral" | "ollama" | "anthropic"

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  baseURL?: string
}

export interface LLMSettings {
  providers: LLMConfig[]
}

export interface LLMRequest {
  prompt: string
  schema?: Record<string, unknown>
  attachments?: any[]
}

export interface LLMResponse {
  output: Record<string, string>
  tokensUsed?: number
  provider: LLMProvider
  error?: string
}

/**
 * Handle Anthropic (Claude) requests natively via the Anthropic SDK.
 * Uses tool_use with a JSON schema to get structured output.
 */
async function requestAnthropic(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: config.apiKey })

  // Build content blocks
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = []

  // Add images first (if any)
  if (req.attachments && req.attachments.length > 0) {
    for (const att of req.attachments) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: att.base64,
        },
      })
    }
  }

  // Add text prompt
  content.push({ type: "text", text: req.prompt })

  // Build the tool definition from the schema
  const tool: Anthropic.Tool = {
    name: "extract_transaction",
    description: "Extract structured transaction data from the document",
    input_schema: (req.schema || { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    temperature: 0,
    tools: [tool],
    tool_choice: { type: "tool", name: "extract_transaction" },
    messages: [{ role: "user", content }],
  })

  // Extract the tool use result
  const toolUse = response.content.find(block => block.type === "tool_use")

  if (!toolUse || toolUse.type !== "tool_use") {
    return {
      output: {},
      provider: "anthropic",
      error: "Claude did not return structured output",
    }
  }

  return {
    output: toolUse.input as Record<string, string>,
    tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    provider: "anthropic",
  }
}

async function requestLLMUnified(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  // Anthropic uses its own SDK path
  if (config.provider === "anthropic") {
    return requestAnthropic(config, req)
  }

  try {
    const temperature = 0
    let model: any
    if (config.provider === "openai") {
      model = new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "google") {
      model = new ChatGoogleGenerativeAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "mistral") {
      model = new ChatMistralAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "ollama") {
      // Ollama exposes an OpenAI-compatible API at /v1
      model = new ChatOpenAI({
        apiKey: "ollama",
        model: config.model,
        temperature: temperature,
        configuration: {
          baseURL: `${config.baseURL || "http://localhost:11434"}/v1`,
        },
      })
    } else {
      return {
        output: {},
        provider: config.provider,
        error: "Unknown provider",
      }
    }

    const structuredOutputOptions = config.provider === "ollama"
      ? { name: "transaction", method: "jsonSchema" as const }
      : { name: "transaction" }
    const structuredModel = model.withStructuredOutput(req.schema, structuredOutputOptions)

    let message_content: any = [{ type: "text", text: req.prompt }]
    if (req.attachments && req.attachments.length > 0) {
      const images = req.attachments.map((att) => ({
        type: "image_url",
        image_url: {
          url: `data:${att.contentType};base64,${att.base64}`,
        },
      }))
      message_content.push(...images)
    }
    const messages: BaseMessage[] = [new HumanMessage({ content: message_content })]

    const response = await structuredModel.invoke(messages)

    return {
      output: response,
      provider: config.provider,
    }
  } catch (error: any) {
    return {
      output: {},
      provider: config.provider,
      error: error instanceof Error ? error.message : `${config.provider} request failed`,
    }
  }
}

export async function requestLLM(settings: LLMSettings, req: LLMRequest): Promise<LLMResponse> {
  for (const config of settings.providers) {
    if (!config.apiKey || !config.model) {
      console.info("Skipping provider:", config.provider)
      continue
    }
    console.info("Use provider:", config.provider)

    const response = await requestLLMUnified(config, req)

    if (!response.error) {
      return response
    } else {
      console.error(response.error)
    }
  }

  return {
    output: {},
    provider: settings.providers[0]?.provider || "openai",
    error: "All LLM providers failed or are not configured",
  }
}
