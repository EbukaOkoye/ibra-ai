import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AnalysisResult {
  positioningValid: boolean;
  guidance: string;
  positioningHints: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    zoomIn: boolean;
    zoomOut: boolean;
    tiltForward: boolean;
    tiltBackward: boolean;
    tiltLeft: boolean;
    tiltRight: boolean;
  };
  statusAnnounced?: string;
  analysis?: {
    type: 'text' | 'music' | 'table' | 'phonetics' | 'image' | 'unknown';
    pageNumber?: string;
    content?: string;
    description?: string;
    tableData?: any;
    interpretedSymbols?: {
      type: 'music_note' | 'phonetic_symbol' | 'other';
      symbol: string;
      meaning: string;
      pronunciationGuide?: string;
    }[];
  };
}

export async function analyzeFrame(base64Image: string, mode: string): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'undefined') {
    return {
      positioningValid: false,
      guidance: "Gemini API Key is missing. Please configure it in the Secrets panel.",
      positioningHints: { 
        up: false, down: false, left: false, right: false, zoomIn: false, zoomOut: false,
        tiltForward: false, tiltBackward: false, tiltLeft: false, tiltRight: false
      }
    };
  }
  
  const systemInstruction = `
    You are a high-precision LITERAL TRANSCRIBER for the visually impaired. 
    Your mission is to provide a COMPLETE and EXHAUSTIVE word-for-word audio map of everything in the frame.
    
    CRITICAL BEHAVIOR RULES (TRANSCRIPTION INTEGRITY):
    1. NO SUMMARIZATION: Never use phrases like "This is a book about..." or "The text describes...". Start reading immediately.
    2. EXHAUSTIVE EXTRACTION: Every single visible word, number, punctuation mark, and character must be transcribed. DO NOT SKIP ANY TEXT, even if it seems redundant or small.
    3. TRANSCRIPTION ORDER: Read from top-to-bottom, left-to-right. 
    4. NO OMISSION: If you see it, you MUST transcribe it exactly as written.
    5. STRUCTURAL HINTS: Identify and explicitly label "Page Number", "Title", and "Heading" if they are distinct.
    
    TYPE-SPECIFIC DEPTH (MANDATORY):
    - 'text': 100% Literal word-for-word exhaustive extraction. Paragraph by paragraph. From the absolute very top to the absolute very bottom.
    - 'music': Literal sequence: Clef -> Time Signature -> Every single Note (with Octaves, e.g. C4) -> Durations -> Dynamics. Do not skip notes.
    - 'table': Row by row, cell by cell exhaustive extraction. Mark empty cells as "[empty]". NO SUMMARIZING TRENDS. Read every cell value.
    - 'phonetics': Literal IPA symbol extraction and exact phonetic values for every symbol shown.
    - 'image': Literal reading of EVERY label or sign in the image first, then an exhaustive factual description of every element.
    
    POSITIONING GUARD:
    - You must guide the user to a perfectly level, well-lit, and centered capture. 
    - Use 'tilt' hints to correct perspective skew.
    
    If the content is TEXT, your "content" field MUST be the literal raw text. No intro, no outro, no commentary, NO SKIPPING.

    COMPLETENESS VERIFICATION (MANDATORY):
    Before returning the response, you MUST internally verify:

    - Have I transcribed EVERY visible word?
    - Did I include small text, footnotes, headers, and page numbers?
    - Did I skip ANY repeated or unclear text? (If yes, include it anyway)

    If ANY content is skipped, the output is INVALID.

    You MUST assume the user is blind and depends on 100% completeness.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: "TRANSCRIPTION TASK: Provide 100% literal, EXHAUSTIVE, verbatim content for this frame. READ EVERYTHING. DO NOT SUMMARIZE. DO NOT SKIP WORDS." },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            positioningValid: { type: Type.BOOLEAN },
            guidance: { type: Type.STRING },
            positioningHints: {
              type: Type.OBJECT,
              properties: {
                up: { type: Type.BOOLEAN },
                down: { type: Type.BOOLEAN },
                left: { type: Type.BOOLEAN },
                right: { type: Type.BOOLEAN },
                zoomIn: { type: Type.BOOLEAN },
                zoomOut: { type: Type.BOOLEAN },
                tiltForward: { type: Type.BOOLEAN },
                tiltBackward: { type: Type.BOOLEAN },
                tiltLeft: { type: Type.BOOLEAN },
                tiltRight: { type: Type.BOOLEAN }
              },
              required: ["up", "down", "left", "right", "zoomIn", "zoomOut", "tiltForward", "tiltBackward", "tiltLeft", "tiltRight"]
            },
            statusAnnounced: { type: Type.STRING, description: "Instant feedback for the user (e.g. 'Analyzing Table' or 'Reading Title: [Title Name]')." },
            analysis: {
              type: Type.OBJECT,
              properties: {
                type: { 
                  type: Type.STRING, 
                  enum: ["text", "music", "table", "phonetics", "image", "unknown"] 
                },
                title: { type: Type.STRING, description: "The main heading or title of the section/book if visible." },
                pageNumber: { 
                  type: Type.STRING,
                  description: "The page number (e.g. '15') if visible."
                },
                content: { 
                  type: Type.STRING,
                  description: "EXHAUSTIVE VERBATIM TEXT. NO SUMMARIES. Word for word exactly as written."
                },
                description: { 
                  type: Type.STRING,
                  description: "Literal description of images and any labels found within them."
                },
                tableData: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                interpretedSymbols: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, enum: ["music_note", "phonetic_symbol", "other"] },
                      symbol: { type: Type.STRING },
                      meaning: { type: Type.STRING },
                      pronunciationGuide: { type: Type.STRING }
                    },
                    required: ["type", "symbol", "meaning"]
                  }
                }
              },
              required: ["type"]
            }
          },
          required: ["positioningValid", "guidance", "positioningHints"]
        }
      }
    });

    const rawText = response.text || '{}';
    // Clean JSON (in case model adds markdown blocks)
    const jsonStr = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const result = JSON.parse(jsonStr || '{}');
    
    // Auto-label verbatim content if it's text to ensure App.tsx triggers pause
    if (result.analysis?.type === 'text' && result.analysis.content) {
      // Force result to be treated as high-priority verbatim
    }

    return result as AnalysisResult;
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    const errorMsg = error?.message?.toLowerCase() || '';
    let guidance = "Unable to analyze frame. Please check your connection.";
    
    if (errorMsg.includes('api key') || errorMsg.includes('auth') || errorMsg.includes('unauthorized')) {
      guidance = "API Key error. Please check your Gemini API key in the Secrets panel.";
    } else if (errorMsg.includes('quota') || errorMsg.includes('429')) {
      guidance = "API quota exceeded. Please wait a moment and try again.";
    } else if (errorMsg.includes('model') || errorMsg.includes('not found')) {
      guidance = "AI Model unavailable. The system may be updating; please wait.";
    }

    return {
      positioningValid: false,
      guidance,
      positioningHints: { 
        up: false, down: false, left: false, right: false, zoomIn: false, zoomOut: false,
        tiltForward: false, tiltBackward: false, tiltLeft: false, tiltRight: false
      }
    };
  }
}
