import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB制限
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.originalname.match(/\.(mov|mp4|m4v|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('動画ファイル（.MOV, .MP4等）のみアップロード可能です。'));
    }
  }
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// スキーマを限界までスリム化して出力途切れを防ぐ
const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    totalDurationSeconds: { type: Type.NUMBER },
    pourEvents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startSeconds: { type: Type.NUMBER },
          endSeconds: { type: Type.NUMBER },
          durationSeconds: { type: Type.NUMBER },
          waterMassGrams: { type: Type.NUMBER, nullable: true },
          massType: { type: Type.STRING, enum: ['measured', 'estimated', 'unavailable'] },
          confidence: { type: Type.STRING, enum: ['高', '中', '低', '判定不可'] }
        }
      }
    },
    groundsEvents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestampSeconds: { type: Type.NUMBER },
          observation: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ['高', '中', '低', '判定不可'] }
        }
      }
    },
    phases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phaseName: { type: Type.STRING, enum: ['ドリップ開始前', '蒸らし', '注湯', '休止', 'ドローダウン', '抽出終了', '不明'] },
          startSeconds: { type: Type.NUMBER },
          endSeconds: { type: Type.NUMBER }
        }
      }
    },
    limitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    }
  }
};

const SYSTEM_INSTRUCTION = `
あなたはプロのバリスタ兼動画解析エンジニアです。ハンドドリップ動画を時系列で解析してください。
【厳格なルール】
1. 事実と推測を明確に区別してください。
2. スケール数値が見えない場合 waterMassGrams は null、massType は 'unavailable' にしてください。
3. 【最重要・文字数制限】出力上限を超えないよう、各項目（pourEvents, groundsEvents, phases）は要点のみ絞り込み、それぞれ最大5〜8件程度に抑えてください。文字列の説明（observationやlimitations）は各10文字程度の超簡潔な表記にしてください。
`;

app.post('/api/analyze', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '動画ファイルが必要です。' });

  let uploadedRemoteFile = null;

  try {
    const videoMimeType = (req.file.mimetype && req.file.mimetype !== 'application/octet-stream')
      ? req.file.mimetype
      : 'video/quicktime';

    console.log(`[1/4] Gemini APIに動画を送信中... (${req.file.originalname}, type: ${videoMimeType})`);
    
    uploadedRemoteFile = await ai.files.upload({
      file: req.file.path,
      mimeType: videoMimeType,
      config: {
        mimeType: videoMimeType
      }
    });

    console.log(`[2/4] 動画の処理完了を待機中... (ファイルID: ${uploadedRemoteFile.name})`);
    let fileState = await ai.files.get({ name: uploadedRemoteFile.name });
    let attempts = 0;
    const maxAttempts = 60;

    while (fileState.state === 'PROCESSING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      fileState = await ai.files.get({ name: uploadedRemoteFile.name });
      attempts++;
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`動画の処理が完了しませんでした（状態: ${fileState.state}）。`);
    }

    console.log(`[3/4] AI解析を実行中...`);
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: fileState.uri, mimeType: fileState.mimeType } },
            { text: 'このハンドドリップ動画を解析し、主要なイベントのみを短く簡潔にまとめた構造化JSONで出力してください。' }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: analysisSchema,
        temperature: 0.1,
        maxOutputTokens: 8192,
      }
    });

    console.log(`[4/4] 解析完了`);
    const parsedData = JSON.parse(response.text);
    res.json(parsedData);

  } catch (error) {
    console.error('エラー発生:', error);
    res.status(500).json({ error: error.message || '解析中に予期せぬエラーが発生しました。' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('ローカルファイルの削除失敗:', err);
      });
    }
    if (uploadedRemoteFile) {
      try {
        await ai.files.delete({ name: uploadedRemoteFile.name });
        console.log(`Geminiサーバー上の動画をクリーンアップしました。`);
      } catch (err) {
        console.error('Geminiファイルの削除失敗:', err);
      }
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend API Running on http://localhost:${PORT}`));