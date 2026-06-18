/**
 * AI 分析服务 - 双引擎: 本地 MobileNet + 云端多模态大模型
 *
 * .env 配置:
 *   AI_PROVIDER=openai        # 启用云端大模型
 *   AI_BASE_URL=              # API 地址（默认 https://api.openai.com/v1）
 *   AI_API_KEY=               # API 密钥
 *   AI_MODEL=gpt-4o           # 模型名称
 */
const fsp = require('fs').promises;
const path = require('path');

// --- 本地 MobileNet ---
let tf, mobilenet, model = null, localReady = false;
let sharp;
try { sharp = require('sharp'); } catch {}

const CATEGORY_MAP = {
  'person': '人物', 'face': '人物', 'portrait': '人物',
  'animal': '动物', 'cat': '动物', 'dog': '动物', 'bird': '动物', 'fish': '动物',
  'horse': '动物', 'elephant': '动物', 'bear': '动物', 'rabbit': '动物', 'butterfly': '动物',
  'landscape': '风景', 'mountain': '风景', 'beach': '风景', 'sea': '风景', 'ocean': '风景',
  'lake': '风景', 'river': '风景', 'waterfall': '风景', 'forest': '风景', 'tree': '风景',
  'flower': '风景', 'garden': '风景', 'sunset': '风景', 'sunrise': '风景', 'sky': '风景', 'snow': '风景',
  'food': '食物', 'fruit': '食物', 'vegetable': '食物', 'cake': '食物', 'bread': '食物',
  'pizza': '食物', 'burger': '食物', 'pasta': '食物', 'sushi': '食物', 'coffee': '食物', 'wine': '食物',
  'car': '交通', 'vehicle': '交通', 'bus': '交通', 'truck': '交通', 'motorcycle': '交通',
  'bicycle': '交通', 'train': '交通', 'airplane': '交通', 'boat': '交通', 'ship': '交通',
  'building': '建筑', 'house': '建筑', 'architecture': '建筑', 'church': '建筑', 'temple': '建筑',
  'tower': '建筑', 'bridge': '建筑', 'city': '建筑', 'castle': '建筑', 'palace': '建筑',
  'computer': '电子', 'laptop': '电子', 'phone': '电子', 'screen': '电子', 'monitor': '电子',
  'keyboard': '电子', 'camera': '电子', 'television': '电子',
  'document': '文档', 'book': '文档', 'paper': '文档', 'menu': '文档', 'poster': '文档',
  'book jacket': '文档', 'comic': '文档', 'web site': '截图',
};

function classifyLocal(labels) {
  const scores = {};
  for (const l of labels) {
    const cn = l.className.toLowerCase(), p = l.probability;
    if (CATEGORY_MAP[cn]) {
      scores[CATEGORY_MAP[cn]] = Math.max(scores[CATEGORY_MAP[cn]] || 0, p);
      continue;
    }
    for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
      if (cn.includes(key)) { scores[cat] = Math.max(scores[cat] || 0, p); break; }
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return { category: '其他', confidence: 0, labels: [] };
  return {
    category: sorted[0][0],
    confidence: Math.round(sorted[0][1] * 100),
    labels: labels.slice(0, 5).map(l => l.className)
  };
}

async function imageToTensor(filePath) {
  const { data, info } = await sharp(filePath)
    .resize(224, 224, { fit: 'cover' })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
}

async function initLocal() {
  if (localReady) return;
  try {
    require('@tensorflow/tfjs-backend-cpu');
    tf = require('@tensorflow/tfjs');
    mobilenet = require('@tensorflow-models/mobilenet');
    await tf.setBackend('cpu');
    await tf.ready();
    model = await mobilenet.load({ version: 1, alpha: 0.25 });
    localReady = true;
    console.log('[AI] MobileNet loaded (cpu)');
  } catch (e) {
    console.warn('[AI] Local model unavailable:', e.message);
  }
}

async function analyzeLocal(filePath) {
  await initLocal();
  if (!model) return null;
  const tensor = await imageToTensor(filePath);
  const predictions = await model.classify(tensor);
  tensor.dispose();
  return classifyLocal(predictions.map(p => ({
    className: p.className,
    probability: p.probability
  })));
}

// --- 云端 LLM ---
const LLM_PROMPT = [
  '分析这张图片，返回纯JSON（不要markdown代码块）：',
  '{',
  '  "summary": "一句话描述图片内容（中文，20字以内）",',
  '  "labels": ["标签1", "标签2", "标签3"],',
  '  "category": "人物|动物|风景|食物|交通|建筑|电子|文档|截图|其他",',
  '  "objects": ["物体1", "物体2"],',
  '  "scene": "室内|室外|不确定",',
  '  "text": "图中文字（无则为空字符串）"',
  '}'
].join('\n');

function parseLLM(content) {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    return {
      category: p.category || '其他',
      confidence: 90,
      labels: p.labels || [],
      summary: p.summary || '',
      objects: p.objects || [],
      scene: p.scene || '',
      text: p.text || '',
      raw: p
    };
  } catch {
    return {
      category: '其他',
      confidence: 50,
      labels: [],
      summary: content.slice(0, 100),
      objects: [],
      scene: '',
      text: ''
    };
  }
}

// --- 视频分析 ---
const VIDEO_PROMPT = [
  '这是一个视频的截图帧。请分析画面内容，返回纯JSON：',
  '{',
  '  "summary": "视频内容一句话描述（中文，20字以内）",',
  '  "labels": ["标签1", "标签2", "标签3"],',
  '  "category": "人物|动物|风景|食物|交通|建筑|电子|文档|截图|其他",',
  '  "objects": ["物体1", "物体2"],',
  '  "scene": "室内|室外|不确定",',
  '  "text": "画面中文字（无则为空字符串）"',
  '}'
].join('\n');

async function analyzeVideo(filePath) {
  // 视频分析：提取中间帧，调用 LLM
  const { execSync } = require('child_process');
  const tmpDir = require('os').tmpdir();
  const tmpFrame = path.join(tmpDir, 'fileftp_vframe_' + Date.now() + '.jpg');

  try {
    // 用 ffprobe 获取视频时长，计算中间点
    let seekTime = '00:00:01';
    try {
      const probeOut = execSync(
        '"' + (process.env.FFMPEG_PATH || 'ffmpeg').replace(/ffmpeg\.exe$/, 'ffprobe.exe').replace(/ffmpeg$/, 'ffprobe') + '"' +
        ' -v quiet -print_format json -show_format "' + filePath + '"',
        { timeout: 5000, encoding: 'utf8' }
      );
      const info = JSON.parse(probeOut);
      const duration = parseFloat(info.format?.duration) || 3;
      const mid = Math.max(1, Math.floor(duration / 2));
      seekTime = new Date(mid * 1000).toISOString().slice(11, 19);
    } catch {}

    // 提取中间帧
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    execSync('"' + ffmpegPath + '" -y -ss ' + seekTime + ' -i "' + filePath +
      '" -vframes 1 -q:v 3 "' + tmpFrame + '" 2>&1', { timeout: 10000 });

    // 用 LLM 分析帧
    const result = await analyzeWithLLM(tmpFrame, VIDEO_PROMPT);
    // 清理临时文件
    try { require('fs').unlinkSync(tmpFrame); } catch {}
    return result;
  } catch (e) {
    console.warn('[AI] Video analysis failed:', e.message);
    try { require('fs').unlinkSync(tmpFrame); } catch {}
    return null;
  }
}

// --- 更新 LLM 分析函数支持自定义 prompt ---
async function analyzeWithLLM(filePath, customPrompt) {
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || 'gpt-4o';

  if (!apiKey) {
    console.warn('[AI] LLM API key not configured');
    return null;
  }

  const buf = await fsp.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimes = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.gif': 'gif', '.webp': 'webp' };
  const mime = mimes[ext] || 'jpeg';
  const b64 = buf.toString('base64');
  const prompt = customPrompt || LLM_PROMPT;

  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/' + mime + ';base64,' + b64 } }
          ]
        }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[AI] LLM error ' + res.status + ':', errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const result = parseLLM(content);
    // 提取 API 返回的 token 用量
    if (result && data.usage) {
      result.promptTokens = data.usage.prompt_tokens || 0;
      result.completionTokens = data.usage.completion_tokens || 0;
      result.totalTokens = data.usage.total_tokens || 0;
    }
    return result;
  } catch (e) {
    console.warn('[AI] LLM request failed:', e.message);
    return null;
  }
}

// --- 统一入口 ---
const aiService = {
  provider: process.env.AI_PROVIDOR || process.env.AI_PROVIDER || 'local',

  async analyzeImage(filePath) {
    if (this.provider === 'openai' && process.env.AI_API_KEY) {
      console.log('[AI] LLM analyzing image:', path.basename(filePath));
      return await analyzeWithLLM(filePath);
    }
    console.log('[AI] Local analyzing:', path.basename(filePath));
    return await analyzeLocal(filePath);
  },

  async analyzeVideo(filePath) {
    console.log('[AI] Analyzing video:', path.basename(filePath));
    // 视频只能用 LLM（本地 MobileNet 不支持视频）
    if (process.env.AI_API_KEY) {
      return await analyzeVideo(filePath);
    }
    console.warn('[AI] Video analysis requires LLM API key');
    return null;
  },

  getTopLabels(result, n) {
    if (!result || !result.labels) return [];
    return result.labels.slice(0, n || 3);
  }
};

module.exports = aiService;
