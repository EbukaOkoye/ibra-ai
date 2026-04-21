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
    You are an expert visual assistant for the visually impaired.
    Your PRIMARY TASK is to AUTOMATICALLY SENSE the type of content in the camera frame.
    
    Current suggested mode (User's preference): ${mode}
    
    INSTRUCTIONS:
    1. Automatic Type Detection:
       Ignore the suggested mode if you see something else. 
       Classify the content into one of these types:
       - 'text': Standard document text, books, or articles.
       - 'music': Musical scores, staves, notes, and clefs.
       - 'phonetics': IPA symbols, phonetic charts, or pronunciation guides.
       - 'table': Grid-based data, schedules, or lists.
       - 'image': Photographs, diagrams, or drawings.
       - 'unknown': If content is unclear or too blurry.
       
    2. Check Positioning:
       - Provide clear guidance to get the best capture.
       - Analyze angle and distance: If the document is tilted, skewed, or at an awkward perspective, provide specific instructions to level the camera.
       - 'tiltForward': True if the top of the document is further than the bottom.
       - 'tiltBackward': True if the bottom is further than the top.
       - 'tiltLeft': True if the left side is further than the right.
       - 'tiltRight': True if the right side is further than the left.
       
    3. Deep Analysis per Type (ABSOLUTE VERBATIM TRANSCRIPTION MANDATORY):
       - If TEXT: [Content: Start transcribing from the top-left to bottom-right. Perform a 100% literal word-for-word capture of every single word visible. ABSOLUTELY NO SUMMARIZATION. Transcribe paragraph by paragraph. Include every character, label, and footer.]
       - If MUSIC: [InterpretedSymbols: Exhaustive literal sequence of every note (e.g., C4, G#5), duration (e.g., quarter note, eighth), dynamic markings (e.g., forte, piano), and clef transitions.]
       - If PHONETICS: [InterpretedSymbols: Literal transcription of every symbol and its exact phonetic value.]
       - If TABLE: [TableData: literal extraction of every cell. DO NOT SKIP EMPTY CELLS; mark them as "[empty]". NO SUMMARIZATION OF ROWS.]
       - If IMAGE: [Description: A 100% literal word-for-word reading of every sign, label, or text visible in the frame. Follow with an exhaustive visual description.]
       
    4. CRITICAL INVARIANT: You are a "LITERAL TRANSCRIBER", not an "INTERPRETER". You MUST NOT summarize, explain, or paraphrase anything. If the detected content is text or a score, you MUST READ IT OUT VERBATIM or PROVIDE THE EXACT MUSICAL SEQUENCE. DO NOT provide a summary; provide ONLY the literal content. The user is visually impaired and relies on you to hear EXACTLY what is on the document. Any failure to provide the exact verbatim content is a CRITICAL SYSTEM FAILURE.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: "Analyze this frame based on your instructions." },
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
            statusAnnounced: { type: Type.STRING, description: "A message to announce to the user via TTS." },
            analysis: {
              type: Type.OBJECT,
              properties: {
                type: { 
                  type: Type.STRING, 
                  enum: ["text", "music", "table", "phonetics", "image", "unknown"] 
                },
                pageNumber: { 
                  type: Type.STRING,
                  description: "The page number if visible."
                },
                content: { 
                  type: Type.STRING,
                  description: "FULL VERBATIM TRANSCRIPTION."
                },
                description: { 
                  type: Type.STRING,
                  description: "Visual description of any images."
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
