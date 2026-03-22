-- Add model_used column to position_adjustments table
ALTER TABLE position_adjustments
ADD COLUMN model_used TEXT DEFAULT 'gemini-3.1-pro-preview';
