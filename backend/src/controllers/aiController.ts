import { Request, Response } from 'express';
import { aiService } from '../services/aiService';
import { asyncHandler } from '../middleware/errorHandler';

export const generateQuestions = asyncHandler(async (req: Request, res: Response) => {
  const { topicId, difficulty, count, questionType } = req.body;
  
  // Validate required fields
  if (!topicId) {
    res.status(400).json({
      success: false,
      error: { message: 'topicId is required' }
    });
    return;
  }

  console.log(`[AI Controller] Request to generate questions:`, { topicId, difficulty, count, questionType });

  try {
    const questions = await aiService.generateQuestions(
      topicId,
      difficulty || 'Medium',
      count || 5
    );
    
    console.log(`[AI Controller] Successfully generated ${questions.length} questions`);
    
    res.status(200).json({
      success: true,
      data: questions,
    });
  } catch (error: any) {
    console.error(`[AI Controller] Error:`, error.message);
    
    res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to generate questions',
        code: 'AI_GENERATION_ERROR'
      }
    });
  }
});

export const getHint = asyncHandler(async (req: Request, res: Response) => {
  // Placeholder
  res.status(200).json({
    success: true,
    data: { hint: "AI Hint generation not implemented yet." },
  });
});

export const explainConcept = asyncHandler(async (req: Request, res: Response) => {
  const { concept } = req.body;
  // Placeholder
  res.status(200).json({
    success: true,
    data: { explanation: `Explanation for ${concept} coming soon.` },
  });
});

export const getRecommendations = asyncHandler(async (req: Request, res: Response) => {
  // There is no persisted recommendation model yet. Do not present sample
  // topics or scores as if they came from this student's exam history.
  res.status(200).json({
    success: true,
    available: false,
    data: [],
  });
});

export const getInsights = asyncHandler(async (req: Request, res: Response) => {
  // No authorized, persisted insight calculation exists yet. An empty result
  // with explicit availability is more truthful than fabricated percentages.
  res.status(200).json({
    success: true,
    available: false,
    data: [],
  });
});

export const chatAssistant = asyncHandler(async (req: Request, res: Response) => {
  const { messages } = req.body as { messages?: { role: string; content: string }[] };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      success: false,
      error: { message: 'messages array is required' }
    });
    return;
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const lastContent = lastUserMessage?.content ?? '';

  const riskyPattern = /(bypass|avoid detection|disable monitoring|circumvent|cheat|hack|exploit|get answers|leak|steal)/i;
  if (riskyPattern.test(lastContent)) {
    res.status(200).json({
      success: true,
      data: {
        reply:
          'I cannot help with cheating or bypassing exam rules. I can explain the rules, how violations work, and how to use the app features.'
      }
    });
    return;
  }

  const normalizedMessages = messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10);

  try {
    // The role comes from the verified JWT, never from the browser payload.
    const reply = await aiService.chatAssistant(normalizedMessages as any, req.user!.role);

    res.status(200).json({
      success: true,
      data: { reply }
    });
  } catch (error: any) {
    console.error('[AI Controller] chatAssistant error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to get AI response',
        code: 'AI_ASSISTANT_ERROR'
      }
    });
  }
});
