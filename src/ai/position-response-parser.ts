/**
 * Parser y schema Zod para la respuesta de Gemini AI en gestión de posición
 */
import { z } from 'zod';

export const positionManagementSchema = z.object({
  action: z.enum(['ADJUST_SL', 'ADJUST_TP', 'ADJUST_BOTH', 'CLOSE', 'HOLD']),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().min(10, 'Reasoning demasiado corto'),
  new_stop_loss: z.number().min(0).nullable(),
  new_take_profit: z.number().min(0).nullable(),
  warnings: z.array(z.string()).default([]),
});

export type PositionManagementResponse = z.infer<typeof positionManagementSchema>;

/**
 * Parsea la respuesta raw de Gemini para gestión de posición
 */
export function parsePositionManagementResponse(rawText: string): {
  success: true;
  data: PositionManagementResponse;
} | {
  success: false;
  error: string;
  rawText: string;
} {
  try {
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
    const validated = positionManagementSchema.parse(parsed);

    // Validaciones de lógica de negocio
    if (validated.action === 'ADJUST_SL' || validated.action === 'ADJUST_BOTH') {
      if (validated.new_stop_loss === null) {
        return {
          success: false,
          error: `${validated.action} requiere new_stop_loss`,
          rawText,
        };
      }
    }

    if (validated.action === 'ADJUST_TP' || validated.action === 'ADJUST_BOTH') {
      if (validated.new_take_profit === null) {
        return {
          success: false,
          error: `${validated.action} requiere new_take_profit`,
          rawText,
        };
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
