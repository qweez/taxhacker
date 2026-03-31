import { requestLLM } from "@/ai/providers/llmProvider"
import type { LLMSettings } from "@/ai/providers/llmProvider"

export type TransactionInput = {
  name: string
  merchant: string | null
  description: string | null
  total: number
  type: string
}

export type CategoryInput = {
  code: string
  name: string
  llm_prompt: string | null
}

/**
 * Use the LLM to categorize a bank transaction by analyzing its
 * name, merchant, and description against a list of available categories.
 *
 * Returns the best-matching category code, or null if no good match.
 */
export async function categorizeBankTransaction(
  transaction: TransactionInput,
  categories: CategoryInput[],
  llmSettings: LLMSettings,
): Promise<string | null> {
  if (categories.length === 0) return null

  const categoryList = categories
    .map((c) => {
      const hint = c.llm_prompt ? ` — ${c.llm_prompt}` : ""
      return `- "${c.code}" (${c.name}${hint})`
    })
    .join("\n")

  const amountFormatted = (transaction.total / 100).toFixed(2)
  const prompt = `You are a bookkeeping assistant. Categorize the following bank transaction into one of the available categories.

Transaction:
- Name: ${transaction.name}
- Merchant: ${transaction.merchant || "N/A"}
- Description: ${transaction.description || "N/A"}
- Amount: ${amountFormatted} EUR
- Type: ${transaction.type}

Available categories:
${categoryList}

Instructions:
- Pick the single best matching category code from the list above.
- If no category is a reasonable match, respond with "none".
- Respond with ONLY the category code (e.g. "food") or "none". No explanation.`

  const schema = {
    type: "object",
    properties: {
      category_code: {
        type: "string",
        description: "The category code that best matches the transaction, or 'none' if no match.",
      },
    },
    required: ["category_code"],
  }

  try {
    const response = await requestLLM(llmSettings, { prompt, schema })

    if (response.error) {
      console.error("LLM categorization error:", response.error)
      return null
    }

    const categoryCode = response.output?.category_code?.trim()?.toLowerCase()

    if (!categoryCode || categoryCode === "none") {
      return null
    }

    // Validate that the returned code actually exists in the provided categories
    const validCodes = new Set(categories.map((c) => c.code.toLowerCase()))
    if (!validCodes.has(categoryCode)) {
      console.warn(`LLM returned unknown category code: "${categoryCode}"`)
      return null
    }

    // Return the original-cased code
    const matched = categories.find((c) => c.code.toLowerCase() === categoryCode)
    return matched?.code ?? null
  } catch (error) {
    console.error("Failed to categorize transaction via LLM:", error)
    return null
  }
}
