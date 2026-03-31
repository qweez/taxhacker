import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatMistralAI } from "@langchain/mistralai"
import { BaseMessage, HumanMessage } from "@langchain/core/messages"
import Anthropic from "@anthropic-ai/sdk"
import { exec } from "child_process"
import { promisify } from "util"
import { writeFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

const execAsync = promisify(exec)

export type LLMProvider = "openai" | "google" | "mistral" | "ollama" | "anthropic" | "xai" | "claude-code"

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

/**
 * Handle xAI (Grok) requests via OpenAI-compatible API.
 * xAI provides a fully OpenAI-compatible endpoint at api.x.ai/v1
 */
async function requestXAI(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  try {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      configuration: {
        baseURL: "https://api.x.ai/v1",
      },
    })

    const structuredModel = model.withStructuredOutput(req.schema || {}, { name: "transaction" })

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

    return { output: response, provider: "xai" }
  } catch (error: any) {
    return { output: {}, provider: "xai", error: error.message || "xAI request failed" }
  }
}

/**
 * Handle Claude Code CLI requests.
 * Uses `claude -p` with --json-schema for structured output.
 * Requires Claude Code installed and authenticated on the server.
 */
async function requestClaudeCode(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  const claudeBin = config.baseURL || "claude"

  try {
    // Write attachments to temp files if present (Claude Code can read files)
    const tempFiles: string[] = []
    let promptText = req.prompt

    if (req.attachments && req.attachments.length > 0) {
      for (let i = 0; i < req.attachments.length; i++) {
        const att = req.attachments[i]
        const ext = att.contentType?.split("/")[1] || "png"
        const tempPath = path.join(tmpdir(), `taxhacker-att-${Date.now()}-${i}.${ext}`)
        await writeFile(tempPath, Buffer.from(att.base64, "base64"))
        tempFiles.push(tempPath)
      }
      promptText += `\n\nAnalyze the attached document images: ${tempFiles.join(", ")}`
    }

    // Build JSON schema arg
    const schemaArg = req.schema ? `--json-schema '${JSON.stringify(req.schema)}'` : ""

    const command = `${claudeBin} -p ${schemaArg} --output-format json --max-turns 1 --no-session-persistence`

    // Pass prompt via stdin to avoid shell escaping issues
    const promptFile = path.join(tmpdir(), `taxhacker-prompt-${Date.now()}.txt`)
    await writeFile(promptFile, promptText)

    const { stdout } = await execAsync(
      `cat "${promptFile}" | ${command}`,
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    )

    // Clean up temp files
    for (const f of [...tempFiles, promptFile]) {
      await unlink(f).catch(() => {})
    }

    // Parse Claude Code JSON output
    const result = JSON.parse(stdout)

    if (result.is_error) {
      return { output: {}, provider: "claude-code", error: result.result || "Claude Code returned an error" }
    }

    // result.result contains the structured output (as string if json-schema was used)
    let output: Record<string, string>
    if (typeof result.result === "string") {
      try {
        output = JSON.parse(result.result)
      } catch {
        output = { raw: result.result }
      }
    } else {
      output = result.result
    }

    return {
      output,
      tokensUsed: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
      provider: "claude-code",
    }
  } catch (error: any) {
    return { output: {}, provider: "claude-code", error: error.message || "Claude Code execution failed" }
  }
}

async function requestLLMUnified(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  // Providers with custom implementations
  if (config.provider === "anthropic") return requestAnthropic(config, req)
  if (config.provider === "xai") return requestXAI(config, req)
  if (config.provider === "claude-code") return requestClaudeCode(config, req)

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
