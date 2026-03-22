import { z } from 'zod';

/**
 * Schema de validación para la respuesta de Gemini AI
 * Si Gemini devuelve algo que no matchea esto, se descarta
 */
export const aiResponseSchema = z.object({
  signal: z.enum(['LONG', 'SHORT', 'WAIT']),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().min(10, 'Reasoning demasiado corto'),
  order_type: z.enum(['MARKET', 'LIMIT']).nullable().default(null),
  entry_price: z.number().min(0).nullable(),
  stop_loss: z.number().min(0).nullable(),
  take_profit: z.number().min(0).nullable(),
  risk_reward_ratio: z.number().min(0).nullable(),
  key_levels: z.object({
    support: z.array(z.number().positive()),
    resistance: z.array(z.number().positive()),
  }),
  warnings: z.array(z.string()).default([]),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;

/**
 * Parsea la respuesta raw de Gemini y la valida con zod
 * Gemini a veces envuelve JSON en backticks o agrega texto
 */
export function parseAiResponse(rawText: string): {
  success: true;
  data: AiResponse;
} | {
  success: false;
  error: string;
  rawText: string;
} {
  try {
    // Limpiar posible markdown wrapping
    let cleaned = rawText.trim();

    // Remover ```json ... ``` o ``` ... ```
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1]!.trim();
    }

    // Intentar encontrar JSON si hay texto antes/después
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    const parsed = JSON.parse(cleaned);
    const validated = aiResponseSchema.parse(parsed);

    // Para señales WAIT, normalizar valores 0 a null
    if (validated.signal === 'WAIT') {
      if (validated.entry_price === 0) validated.entry_price = null;
      if (validated.stop_loss === 0) validated.stop_loss = null;
      if (validated.take_profit === 0) validated.take_profit = null;
      if (validated.risk_reward_ratio === 0) validated.risk_reward_ratio = null;
      validated.order_type = null;
    }

    // Para señales LONG/SHORT, default a MARKET si no viene order_type (backward compat)
    if (validated.signal !== 'WAIT' && validated.order_type === null) {
      validated.order_type = 'MARKET';
    }

    // Validaciones de lógica de negocio adicionales
    if (validated.signal !== 'WAIT') {
      if (validated.entry_price === null || validated.stop_loss === null || validated.take_profit === null) {
        return {
          success: false,
          error: `${validated.signal} signal requiere entry_price, stop_loss y take_profit`,
          rawText,
        };
      }

      if (validated.signal === 'LONG') {
        if (validated.stop_loss >= validated.entry_price) {
          return { success: false, error: 'LONG signal pero stop_loss >= entry_price', rawText };
        }
        if (validated.take_profit <= validated.entry_price) {
          return { success: false, error: 'LONG signal pero take_profit <= entry_price', rawText };
        }
      }

      if (validated.signal === 'SHORT') {
        if (validated.stop_loss <= validated.entry_price) {
          return { success: false, error: 'SHORT signal pero stop_loss <= entry_price', rawText };
        }
        if (validated.take_profit >= validated.entry_price) {
          return { success: false, error: 'SHORT signal pero take_profit >= entry_price', rawText };
        }
      }
    }

    return { success: true, data: validated };
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : err instanceof Error
        ? err.message
        : 'Unknown parsing error';

    return {
      success: false,
      error: message,
      rawText,
    };
  }
}
