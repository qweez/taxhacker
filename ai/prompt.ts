import { Category, Field, Project } from "@/prisma/client"
import { GERMAN_INVOICE_SYSTEM_PROMPT } from "@/ai/prompts/german-invoice"

/**
 * Map of locale codes to their specialised prompt templates.
 * When a locale key matches, the corresponding prompt is used instead of the
 * generic default.  The German prompt extracts all mandatory fields required
 * by section 14 UStG.
 */
export const LOCALE_PROMPTS: Record<string, string> = {
  de: GERMAN_INVOICE_SYSTEM_PROMPT,
}

export function buildLLMPrompt(
  promptTemplate: string,
  fields: Field[],
  categories: Category[] = [],
  projects: Project[] = [],
  locale?: string
) {
  // If a locale is provided and a specialised prompt exists, use it instead
  let prompt = locale && LOCALE_PROMPTS[locale] ? LOCALE_PROMPTS[locale] : promptTemplate

  prompt = prompt.replace(
    "{fields}",
    fields
      .filter((field) => field.llm_prompt)
      .map((field) => `- ${field.code}: ${field.llm_prompt}`)
      .join("\n")
  )

  prompt = prompt.replace(
    "{categories}",
    categories
      .filter((category) => category.llm_prompt)
      .map((category) => `- ${category.code}: for ${category.llm_prompt}`)
      .join("\n")
  )

  prompt = prompt.replace(
    "{projects}",
    projects
      .filter((project) => project.llm_prompt)
      .map((project) => `- ${project.code}: for ${project.llm_prompt}`)
      .join("\n")
  )

  prompt = prompt.replace("{categories.code}", categories.map((category) => `${category.code}`).join(", "))
  prompt = prompt.replace("{projects.code}", projects.map((project) => `${project.code}`).join(", "))

  return prompt
}
