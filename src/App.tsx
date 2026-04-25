import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ApiOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  HistoryOutlined,
  PictureOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Empty,
  Input,
  InputNumber,
  Modal,
  Progress,
  Rate,
  Segmented,
  Select,
  Slider,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { TabsProps } from 'antd'
import './App.css'

type Provider = 'openai' | 'gemini'
type AuthMode = 'bearer' | 'query'
type StudioMode = 'text-to-image' | 'image-to-image'
type RunPhase = 'idle' | 'testing' | 'running' | 'success' | 'error'
type BatchMode = 'single' | 'prompt-list' | 'reroll'
type PromptTemplateScope = 'all' | 'favorites' | 'recent'
type QueueTaskStatus = 'pending' | 'running' | 'success' | 'error'
type ImageDecision = 'keep' | 'discard' | 'unrated'

interface ConnectionConfig {
  provider: Provider
  authMode: AuthMode
  baseUrl: string
  apiKey: string
  model: string
  modelsPath: string
  openaiTextPath: string
  openaiEditPath: string
  geminiPathTemplate: string
  extraHeaders: string
}

interface GenerationConfig {
  prompt: string
  negativePrompt: string
  resolution: string
  aspectRatio: string
  imageCount: number
  quality: 'standard' | 'high'
  outputFormat: 'png' | 'jpeg' | 'webp'
  background: 'auto' | 'opaque' | 'transparent'
  style: string
  temperature: number
  seed: number | null
  strength: number
}

interface ImageSourceState {
  file: File | null
  previewUrl: string
  imageUrl: string
}

interface StudioImage {
  id: string
  src: string
  mimeType: string
}

interface HistoryRecord {
  id: string
  createdAt: string
  provider: Provider
  model: string
  mode: StudioMode
  prompt: string
  folder?: string
  tags?: string[]
  endpoint: string
  status: 'success' | 'error'
  statusCode?: number
  latencyMs?: number
  images: StudioImage[]
  imageCount: number
  note: string
  responseSnippet: string
}

interface RunState {
  phase: RunPhase
  message: string
  endpoint: string
  statusCode?: number
  latencyMs?: number
}

interface PreparedRequest {
  endpoint: string
  init: RequestInit
  requestPreview: string
  expectsSse?: boolean
}

interface BatchConfig {
  mode: BatchMode
  promptList: string
  rerollCount: number
}

interface PromptTemplate {
  id: string
  label: string
  category: string
  tags: string[]
  prompt: string
  negativePrompt?: string
  recommendedStyle?: string
}

interface PromptTemplateStore {
  favorites: string[]
  recent: string[]
}

interface ParameterPreset {
  id: string
  name: string
  generation: GenerationConfig
  batch: BatchConfig
}

interface QueueTask {
  id: string
  prompt: string
  status: QueueTaskStatus
  model: string
  endpoint: string
  startedAt?: number
  finishedAt?: number
  latencyMs?: number
  message?: string
}

interface UsageStatSnapshot {
  date: string
  requests: number
  images: number
  estimatedCostUsd: number
}

interface UsageStore {
  days: UsageStatSnapshot[]
}

interface GenerateRuntimeConfig {
  maxConcurrency: number
  requestIntervalMs: number
  dailyImageQuota: number
  dailyBudgetUsd: number
  fallbackBaseUrls: string
  qualityGuardEnabled: boolean
  blockedWords: string
  minPromptLength: number
  enableSeedExperiment: boolean
  seedDelta: number
}

interface HistoryFilter {
  keyword: string
  status: 'all' | 'success' | 'error'
  mode: 'all' | StudioMode
  folder: string
  fromDate: string
  toDate: string
}

interface ImageReview {
  rating: number
  note: string
  decision: ImageDecision
}

interface WorkspaceProfile {
  id: string
  name: string
  connection: ConnectionConfig
  generation: GenerationConfig
  batch: BatchConfig
}

interface MaskEditorState {
  enabled: boolean
  protectMode: 'keep-center' | 'edit-center'
  maskNote: string
}

interface UploadAnalysis {
  mimeType: string
  sizeKb: number
  width?: number
  height?: number
}

interface StreamEventTrace {
  at: string
  type: string
  preview: string
}

const { Title, Paragraph, Text } = Typography

const CONNECTION_KEY = 'aurora-image-studio.connection.v1'
const GENERATION_KEY = 'aurora-image-studio.generation.v1'
const HISTORY_KEY = 'aurora-image-studio.history.v1'
const BATCH_KEY = 'aurora-image-studio.batch.v1'
const PROMPT_TEMPLATE_KEY = 'aurora-image-studio.prompt-templates.v1'
const PRESET_KEY = 'aurora-image-studio.parameter-presets.v1'
const USAGE_KEY = 'aurora-image-studio.usage.v1'
const RUNTIME_KEY = 'aurora-image-studio.runtime.v1'
const WORKSPACE_KEY = 'aurora-image-studio.workspace.v1'

const OPENAI_MODELS = ['gpt-5.4', 'gpt-5.2', 'gpt-5.4-mini']
const GEMINI_MODELS = ['nanobanana2']
const RESOLUTION_OPTIONS = ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096']
const ASPECT_RATIO_OPTIONS = ['auto', '1:1', '4:3', '3:2', '16:9', '9:16']
const STYLE_OPTIONS = [
  'auto',
  'cinematic',
  'editorial',
  'illustration',
  'photoreal',
  'fantasy art',
  'ink & wash',
]
const UI_UPGRADE_PLAN = [
  {
    title: '视觉语言统一',
    detail: '重建主题层次、材质与动效，建立稳定的高质感工作台外观。',
  },
  {
    title: '交互效率提升',
    detail: '增加快捷预设与焦点流程，减少配置摩擦与重复操作。',
  },
  {
    title: '信息层级强化',
    detail: '压缩低价值噪音，突出状态、模型与请求链路关键反馈。',
  },
]
const PROMPT_TEMPLATE_LIBRARY: PromptTemplate[] = [
  {
    id: 'cinematic-portrait',
    label: '电影级人像',
    category: '人像',
    tags: ['电影感', '85mm', '逆光'],
    prompt:
      '电影级写实人像，85mm镜头，浅景深，逆光轮廓光，真实皮肤细节，色彩层次丰富。',
    negativePrompt: '畸形手部，皮肤塑料感，低清晰度，文字水印',
    recommendedStyle: 'cinematic',
  },
  {
    id: 'oriental-courtyard',
    label: '国风场景',
    category: '场景',
    tags: ['国风', '庭院', '体积光'],
    prompt:
      '中式古建筑庭院，丝绸服饰人物，晨雾光束，木结构细节清晰，电影构图，超清晰。',
    negativePrompt: '现代广告牌，塑料质感，画面脏污，低对比',
    recommendedStyle: 'cinematic',
  },
  {
    id: 'luxury-product',
    label: '产品海报',
    category: '商业',
    tags: ['产品', '海报', '商业'],
    prompt:
      '高端产品商业海报，主体居中，玻璃与金属材质，工作室灯光，背景渐变，广告级质感。',
    negativePrompt: 'LOGO错位，文案乱码，边缘模糊，噪点',
    recommendedStyle: 'editorial',
  },
  {
    id: 'cyberpunk-night',
    label: '赛博夜景',
    category: '场景',
    tags: ['赛博', '夜景', '霓虹'],
    prompt:
      '雨夜赛博城市街道，霓虹招牌反射，动态人群，体积光，广角镜头，视觉冲击力强。',
    negativePrompt: '低对比，过曝高光，透视崩坏，细节糊化',
    recommendedStyle: 'cinematic',
  },
  {
    id: 'editorial-fashion',
    label: '时尚大片',
    category: '人像',
    tags: ['时尚', '棚拍', '大片'],
    prompt:
      '高级时尚杂志封面风格，冷色主调，利落造型，硬光与轮廓光，服装材质层次分明。',
    negativePrompt: '廉价布料感，五官错位，肢体异常，杂乱背景',
    recommendedStyle: 'editorial',
  },
  {
    id: 'brand-key-visual',
    label: '品牌主视觉',
    category: '品牌',
    tags: ['品牌', '主视觉', 'KV'],
    prompt:
      '品牌主视觉海报，强识别色块与几何构图，主体突出，氛围简洁，适用于首页首屏。',
    negativePrompt: '构图拥挤，信息噪音，低饱和发灰，主体不清晰',
    recommendedStyle: 'editorial',
  },
  {
    id: 'ink-illustration',
    label: '水墨插画',
    category: '插画',
    tags: ['水墨', '插画', '留白'],
    prompt:
      '东方水墨插画风，留白构图，墨色层次自然，山石树木细腻，画面意境空灵。',
    negativePrompt: '油画笔触，西式写实阴影，过度锐化，颜色脏浊',
    recommendedStyle: 'ink & wash',
  },
  {
    id: 'fantasy-creature',
    label: '奇幻生物',
    category: '插画',
    tags: ['奇幻', '角色', '设定'],
    prompt:
      '奇幻世界生物设定图，完整全身，精致材质，动态姿态，环境氛围光丰富，概念设定级质量。',
    negativePrompt: '解剖错误，比例失衡，武器穿模，纹理糊化',
    recommendedStyle: 'fantasy art',
  },
  {
    id: 'architecture-wide',
    label: '建筑广角',
    category: '场景',
    tags: ['建筑', '广角', '空间'],
    prompt:
      '现代建筑外观广角拍摄，透视准确，线条干净，天空层次丰富，建筑材质真实。',
    negativePrompt: '透视歪斜，线条抖动，玻璃反射异常，边缘锯齿',
    recommendedStyle: 'photoreal',
  },
  {
    id: 'food-closeup',
    label: '美食特写',
    category: '商业',
    tags: ['美食', '特写', '广告'],
    prompt:
      '美食广告级特写，浅景深，食材纹理与光泽清晰，暖色氛围光，画面具有食欲感。',
    negativePrompt: '食材变形，脏污餐具，油腻反光过强，低清晰度',
    recommendedStyle: 'photoreal',
  },
  {
    id: 'anime-poster',
    label: '动漫海报',
    category: '海报',
    tags: ['动漫', '海报', '高饱和'],
    prompt:
      '二次元角色海报构图，强烈色彩对比，清晰线稿，动态姿势，背景具备叙事元素。',
    negativePrompt: '线条模糊，手指错误，脸部崩坏，画面脏点',
    recommendedStyle: 'illustration',
  },
  {
    id: 'minimal-product',
    label: '极简产品图',
    category: '商业',
    tags: ['极简', '产品', '静物'],
    prompt:
      '极简产品静物图，干净背景，单向主光，柔和阴影，材质细节准确，留足版面空间。',
    negativePrompt: '背景脏乱，材质失真，过度反射，主体偏移',
    recommendedStyle: 'editorial',
  },
]
const QUICK_TEMPLATE_IDS = [
  'cinematic-portrait',
  'oriental-courtyard',
  'luxury-product',
  'cyberpunk-night',
]
const PROMPT_GUIDE_URL = 'https://youmind.com/zh-CN/gpt-image-2-prompts'
const IMAGE_MODEL_FALLBACK_MODELS = ['nanobanana2']
const OPENAI_IMAGE_TOOL_MODEL = 'gpt-image-2'
const MODEL_UNAVAILABLE_PATTERN =
  /(全部渠道不可提供当前模型|当前模型不可用|model unavailable|not available|no channel|unsupported model)/i
const INPUT_STREAM_ERROR_PATTERN = /error in input stream|input stream/i
const MAX_IMAGE_INPUT_EDGE = 1536
const MAX_IMAGE_INPUT_BYTES = 1_800_000
const SUPPORTED_IMAGE_INPUT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const ASXS_PROXY_BASE_URL = '/api-asxs/v1'
const DIRECT_ASXS_BASE_URL = 'https://api.asxs.top/v1'
const DEFAULT_OPENAI_BASE_URL = ASXS_PROXY_BASE_URL

const DEFAULT_CONNECTION: ConnectionConfig = {
  provider: 'openai',
  authMode: 'bearer',
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  apiKey: '',
  model: 'gpt-5.4',
  modelsPath: '/models',
  openaiTextPath: '/responses',
  openaiEditPath: '/responses',
  geminiPathTemplate: '/v1beta/models/{model}:generateContent',
  extraHeaders: '',
}

const DEFAULT_GENERATION: GenerationConfig = {
  prompt: '',
  negativePrompt: '',
  resolution: '1024x1024',
  aspectRatio: 'auto',
  imageCount: 1,
  quality: 'high',
  outputFormat: 'png',
  background: 'auto',
  style: 'auto',
  temperature: 0.7,
  seed: null,
  strength: 0.65,
}

const DEFAULT_BATCH: BatchConfig = {
  mode: 'single',
  promptList: '',
  rerollCount: 6,
}

const DEFAULT_PROMPT_TEMPLATE_STORE: PromptTemplateStore = {
  favorites: [],
  recent: [],
}

const DEFAULT_RUNTIME_CONFIG: GenerateRuntimeConfig = {
  maxConcurrency: 2,
  requestIntervalMs: 300,
  dailyImageQuota: 120,
  dailyBudgetUsd: 15,
  fallbackBaseUrls: '',
  qualityGuardEnabled: true,
  blockedWords: '血腥,暴力,仇恨,违法',
  minPromptLength: 6,
  enableSeedExperiment: false,
  seedDelta: 77,
}

const DEFAULT_USAGE_STORE: UsageStore = {
  days: [],
}

const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  keyword: '',
  status: 'all',
  mode: 'all',
  folder: '',
  fromDate: '',
  toDate: '',
}

const DEFAULT_MASK_EDITOR: MaskEditorState = {
  enabled: false,
  protectMode: 'keep-center',
  maskNote: '',
}

const INITIAL_RUN_STATE: RunState = {
  phase: 'idle',
  message: '等待任务启动',
  endpoint: '',
}

function isAsxsHostUrl(value: string): boolean {
  return /^https?:\/\/api\.asxs\.top(?:\/|$)/i.test(value.trim())
}

function resolveRuntimeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    return trimmed
  }
  if (trimmed.startsWith('/api-asxs')) {
    return trimmed
  }
  const asxsMatch = trimmed.match(/^https?:\/\/api\.asxs\.top(\/.*)?$/i)
  if (asxsMatch) {
    const suffix = asxsMatch[1] ?? ''
    if (!suffix || suffix === '/' || suffix === '/v1') {
      return ASXS_PROXY_BASE_URL
    }
    if (suffix.startsWith('/v1/')) {
      return `/api-asxs${suffix}`
    }
    return `/api-asxs${suffix}`
  }
  return trimmed
}

function normalizeConnectionDefaults(connection: ConnectionConfig): ConnectionConfig {
  const normalizedBase = connection.baseUrl.trim()
  const normalizedModelsPath = connection.modelsPath.trim()
  const normalizedOpenaiTextPath = connection.openaiTextPath.trim()
  const normalizedOpenaiEditPath = connection.openaiEditPath.trim()

  const isLegacyBuiltInDefault =
    connection.provider === 'openai' &&
    normalizedBase === 'https://api.openai.com' &&
    (normalizedModelsPath === '/models' || normalizedModelsPath === '/v1/models') &&
    normalizedOpenaiTextPath === '/v1/images/generations' &&
    normalizedOpenaiEditPath === '/v1/images/edits'

  if (isLegacyBuiltInDefault) {
    return {
      ...connection,
      baseUrl: DEFAULT_CONNECTION.baseUrl,
      modelsPath: DEFAULT_CONNECTION.modelsPath,
      openaiTextPath: DEFAULT_CONNECTION.openaiTextPath,
      openaiEditPath: DEFAULT_CONNECTION.openaiEditPath,
      model: DEFAULT_CONNECTION.model,
    }
  }

  const fullResponsesEndpoint = normalizedBase.match(
    /^(https?:\/\/[^/]+)\/v1\/responses(?:\/|\?.*)?$/i,
  )
  if (fullResponsesEndpoint) {
    return {
      ...connection,
      baseUrl: resolveRuntimeBaseUrl(`${fullResponsesEndpoint[1]}/v1`),
      modelsPath: '/models',
      openaiTextPath: '/responses',
      openaiEditPath: '/responses',
    }
  }

  const shouldSwitchToProxyForLegacyResponses =
    connection.provider === 'openai' &&
    isAsxsHostUrl(normalizedBase) &&
    (normalizedModelsPath === '/v1/responses' ||
      normalizedModelsPath === '/v1/models' ||
      normalizedModelsPath === '/models') &&
    (normalizedOpenaiTextPath === '/v1/responses' || normalizedOpenaiTextPath === '/responses') &&
    (normalizedOpenaiEditPath === '/v1/responses' || normalizedOpenaiEditPath === '/responses')

  if (shouldSwitchToProxyForLegacyResponses) {
    return {
      ...connection,
      baseUrl: resolveRuntimeBaseUrl(DIRECT_ASXS_BASE_URL),
      modelsPath: '/models',
      openaiTextPath: '/responses',
      openaiEditPath: '/responses',
    }
  }

  if (connection.provider === 'openai' && isAsxsHostUrl(normalizedBase)) {
    return {
      ...connection,
      baseUrl: resolveRuntimeBaseUrl(normalizedBase),
      modelsPath:
        normalizedModelsPath === '/v1/models'
          ? '/models'
          : normalizedModelsPath || connection.modelsPath,
    }
  }

  if (
    connection.provider === 'openai' &&
    normalizedBase === DIRECT_ASXS_BASE_URL &&
    (normalizedModelsPath === '/v1/models' ||
      normalizedOpenaiTextPath === '/v1/responses' ||
      normalizedOpenaiEditPath === '/v1/responses')
  ) {
    return {
      ...connection,
      modelsPath: normalizedModelsPath === '/v1/models' ? '/models' : connection.modelsPath,
      openaiTextPath: '/responses',
      openaiEditPath: '/responses',
    }
  }

  if (
    connection.provider === 'openai' &&
    normalizedBase.startsWith('/api-asxs/v1') &&
    (normalizedModelsPath === '/v1/models' ||
      normalizedOpenaiTextPath === '/v1/responses' ||
      normalizedOpenaiEditPath === '/v1/responses')
  ) {
    return {
      ...connection,
      modelsPath: normalizedModelsPath === '/v1/models' ? '/models' : connection.modelsPath,
      openaiTextPath:
        normalizedOpenaiTextPath === '/v1/responses' ? '/responses' : connection.openaiTextPath,
      openaiEditPath:
        normalizedOpenaiEditPath === '/v1/responses' ? '/responses' : connection.openaiEditPath,
    }
  }

  return connection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStoredObject<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || Array.isArray(parsed)) {
      return fallback
    }
    return { ...fallback, ...(parsed as Partial<T>) }
  } catch {
    return fallback
  }
}

function readStoredHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item) => isRecord(item))
      .slice(0, 40)
      .map((item) => {
        const images = Array.isArray(item.images)
          ? item.images
              .filter((image) => isRecord(image))
              .map((image, index) => ({
                id: typeof image.id === 'string' ? image.id : `cached-${index}`,
                src: typeof image.src === 'string' ? image.src : '',
                mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
              }))
              .filter((image) => image.src.length > 0)
          : []

        return {
          id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          provider: item.provider === 'gemini' ? 'gemini' : 'openai',
          model: typeof item.model === 'string' ? item.model : '',
          mode: item.mode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
          prompt: typeof item.prompt === 'string' ? item.prompt : '',
          folder: typeof item.folder === 'string' ? item.folder : '',
          tags: Array.isArray(item.tags)
            ? item.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .slice(0, 8)
            : [],
          endpoint: typeof item.endpoint === 'string' ? item.endpoint : '',
          status: item.status === 'error' ? 'error' : 'success',
          statusCode: typeof item.statusCode === 'number' ? item.statusCode : undefined,
          latencyMs: typeof item.latencyMs === 'number' ? item.latencyMs : undefined,
          images,
          imageCount: typeof item.imageCount === 'number' ? item.imageCount : images.length,
          note: typeof item.note === 'string' ? item.note : '',
          responseSnippet:
            typeof item.responseSnippet === 'string' ? item.responseSnippet : '',
        } satisfies HistoryRecord
      })
  } catch {
    return []
  }
}

function normalizePromptTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const templateIds = new Set(PROMPT_TEMPLATE_LIBRARY.map((item) => item.id))
  const deduped: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }
    if (!templateIds.has(item) || deduped.includes(item)) {
      continue
    }
    deduped.push(item)
    if (deduped.length >= 40) {
      break
    }
  }
  return deduped
}

function readStoredPromptTemplateStore(): PromptTemplateStore {
  const parsed = readStoredObject(PROMPT_TEMPLATE_KEY, DEFAULT_PROMPT_TEMPLATE_STORE)
  return {
    favorites: normalizePromptTemplateIds(parsed.favorites),
    recent: normalizePromptTemplateIds(parsed.recent).slice(0, 20),
  }
}

function readStoredPresets(): ParameterPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item) => isRecord(item))
      .slice(0, 30)
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `preset-${index}`,
        name: typeof item.name === 'string' ? item.name : `预设 ${index + 1}`,
        generation: {
          ...DEFAULT_GENERATION,
          ...(isRecord(item.generation) ? item.generation : {}),
        } as GenerationConfig,
        batch: {
          ...DEFAULT_BATCH,
          ...(isRecord(item.batch) ? item.batch : {}),
        } as BatchConfig,
      }))
  } catch {
    return []
  }
}

function readUsageStore(): UsageStore {
  const parsed = readStoredObject(USAGE_KEY, DEFAULT_USAGE_STORE)
  if (!Array.isArray(parsed.days)) {
    return DEFAULT_USAGE_STORE
  }
  const days = parsed.days
    .filter((item) => isRecord(item))
    .slice(0, 60)
    .map((item) => ({
      date: typeof item.date === 'string' ? item.date : '',
      requests: typeof item.requests === 'number' ? item.requests : 0,
      images: typeof item.images === 'number' ? item.images : 0,
      estimatedCostUsd: typeof item.estimatedCostUsd === 'number' ? item.estimatedCostUsd : 0,
    }))
    .filter((item) => item.date)
  return { days }
}

function readWorkspaceProfiles(): WorkspaceProfile[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item) => isRecord(item))
      .slice(0, 20)
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `space-${index}`,
        name: typeof item.name === 'string' ? item.name : `空间 ${index + 1}`,
        connection: {
          ...DEFAULT_CONNECTION,
          ...(isRecord(item.connection) ? item.connection : {}),
        } as ConnectionConfig,
        generation: {
          ...DEFAULT_GENERATION,
          ...(isRecord(item.generation) ? item.generation : {}),
        } as GenerationConfig,
        batch: {
          ...DEFAULT_BATCH,
          ...(isRecord(item.batch) ? item.batch : {}),
        } as BatchConfig,
      }))
  } catch {
    return []
  }
}

function getTodayStamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function estimateImageCostUsd(provider: Provider, imageCount: number, quality: GenerationConfig['quality']): number {
  const unit =
    provider === 'openai'
      ? quality === 'high'
        ? 0.08
        : 0.04
      : quality === 'high'
        ? 0.03
        : 0.015
  return Number((Math.max(1, imageCount) * unit).toFixed(4))
}

function updateUsageStore(
  store: UsageStore,
  provider: Provider,
  images: number,
  quality: GenerationConfig['quality'],
): UsageStore {
  const today = getTodayStamp()
  const cost = estimateImageCostUsd(provider, images, quality)
  const days = [...store.days]
  const index = days.findIndex((item) => item.date === today)
  if (index >= 0) {
    const snapshot = days[index]
    days[index] = {
      ...snapshot,
      requests: snapshot.requests + 1,
      images: snapshot.images + images,
      estimatedCostUsd: Number((snapshot.estimatedCostUsd + cost).toFixed(4)),
    }
  } else {
    days.unshift({
      date: today,
      requests: 1,
      images,
      estimatedCostUsd: cost,
    })
  }
  return { days: days.slice(0, 60) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function normalizeUrlLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function parsePromptImport(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return []
  }
  if (trimmed.startsWith('[')) {
    const parsed = safeJsonParse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    }
  }
  if (trimmed.startsWith('{')) {
    const parsed = safeJsonParse(trimmed)
    if (isRecord(parsed) && Array.isArray(parsed.prompts)) {
      return parsed.prompts
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    }
  }
  if (trimmed.includes(',') && trimmed.split('\n').length <= 2) {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return parsePromptList(trimmed)
}

function validatePromptQuality(prompt: string, runtime: GenerateRuntimeConfig): string[] {
  const issues: string[] = []
  const trimmed = prompt.trim()
  if (trimmed.length < runtime.minPromptLength) {
    issues.push(`提示词长度不足（当前 ${trimmed.length}，最少 ${runtime.minPromptLength}）`)
  }
  const blockedWords = runtime.blockedWords
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const lowerPrompt = trimmed.toLowerCase()
  const hits = blockedWords.filter((word) => lowerPrompt.includes(word.toLowerCase()))
  if (hits.length > 0) {
    issues.push(`命中敏感词：${hits.join('、')}`)
  }
  return issues
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function crc32(bytes: Uint8Array): number {
  const table = (() => {
    const items = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      }
      items[i] = c >>> 0
    }
    return items
  })()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = utf8Bytes(file.name)
    const crc = crc32(file.data)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint16(12, 0, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, file.data.length, true)
    localView.setUint32(22, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, file.data.length, true)
    centralView.setUint32(24, file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(nameBytes, 46)

    localParts.push(localHeader, file.data)
    centralParts.push(centralHeader)
    offset += localHeader.length + file.data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true)

  const totalSize =
    localParts.reduce((sum, part) => sum + part.length, 0) +
    centralSize +
    end.length
  const output = new Uint8Array(totalSize)
  let cursor = 0
  for (const part of localParts) {
    output.set(part, cursor)
    cursor += part.length
  }
  for (const part of centralParts) {
    output.set(part, cursor)
    cursor += part.length
  }
  output.set(end, cursor)
  return output
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage write failures (for example QuotaExceededError) to avoid runtime crashes.
  }
}

function sanitizeHistoryForStorage(records: HistoryRecord[]): HistoryRecord[] {
  return records.slice(0, 40).map((item) => ({
    ...item,
    images: item.images
      .filter((image) => typeof image.src === 'string' && !image.src.startsWith('data:image/'))
      .slice(0, 8),
    note: item.note.slice(0, 1200),
    responseSnippet: item.responseSnippet.slice(0, 1600),
    folder: (item.folder ?? '').slice(0, 48),
    tags: (item.tags ?? []).map((tag) => tag.slice(0, 24)).slice(0, 8),
  }))
}

function getHistoryImages(images: StudioImage[]): StudioImage[] {
  return images.filter((image) => typeof image.src === 'string' && !image.src.startsWith('data:image/'))
}

function parseExtraHeaders(extraHeaders: string): Record<string, string> {
  const trimmed = extraHeaders.trim()
  if (!trimmed) {
    return {}
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!isRecord(parsed)) {
        return {}
      }
      const pairs = Object.entries(parsed).filter(([, value]) => typeof value === 'string')
      return Object.fromEntries(pairs) as Record<string, string>
    } catch {
      return {}
    }
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const result: Record<string, string> = {}
  for (const line of lines) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key && value) {
      result[key] = value
    }
  }

  return result
}

function buildUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  const cleanPath = path.trim()
  if (!cleanPath) {
    return cleanBase
  }
  if (/^https?:\/\//i.test(cleanPath)) {
    return cleanPath
  }
  return `${cleanBase}/${cleanPath.replace(/^\/+/, '')}`
}

function isResponsesEndpoint(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return /\/responses(?:\/|$|\?)/.test(normalized)
}

function withQueryParam(url: string, key: string, value: string): string {
  if (!value.trim()) {
    return url
  }
  try {
    const parsed = new URL(url)
    parsed.searchParams.set(key, value)
    return parsed.toString()
  } catch {
    const divider = url.includes('?') ? '&' : '?'
    return `${url}${divider}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }
}

function looksLikeImageUrl(text: string): boolean {
  if (text.startsWith('data:image/')) {
    return true
  }
  return /^https?:\/\/.+(\.png|\.jpg|\.jpeg|\.webp|\.gif|\.bmp|\.avif)(\?.*)?$/i.test(text)
}

function makeDataUrl(base64: string, mimeType?: string): string {
  const normalized = base64.replace(/\s+/g, '')
  const mime = mimeType?.trim() || 'image/png'
  return `data:${mime};base64,${normalized}`
}

function safeJsonParse(raw: string): unknown {
  if (!raw.trim()) {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

interface StreamParseResult {
  images: StudioImage[]
  outputText: string
  raw: string
  eventTypes: string[]
  hasOutputItemDone: boolean
  events: StreamEventTrace[]
}

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return isRecord(value) ? value : null
}

function parseJsonLikeString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return value
  }
  return safeJsonParse(trimmed)
}

function extractImagesFromOutputItemDoneEvent(eventType: string, payload: unknown): StudioImage[] {
  const normalizedEventType = eventType.trim()
  if (!isRecord(payload)) {
    return []
  }

  const payloadType =
    typeof payload.type === 'string'
      ? payload.type.trim()
      : typeof payload.event === 'string'
        ? payload.event.trim()
        : ''
  const isOutputItemDoneEvent =
    normalizedEventType === 'response.output_item.done' || payloadType === 'response.output_item.done'
  if (!isOutputItemDoneEvent) {
    return []
  }

  const candidateNodes: unknown[] = [payload]
  const pushObjectCandidate = (candidate: unknown) => {
    const parsedCandidate = parseJsonLikeString(candidate)
    if (isRecord(parsedCandidate)) {
      candidateNodes.push(parsedCandidate)
    }
  }

  const directItem = payload.item
  pushObjectCandidate(directItem)
  const outputItem = payload.output_item
  pushObjectCandidate(outputItem)
  const rawDataNode = payload.data
  pushObjectCandidate(rawDataNode)
  if (isRecord(rawDataNode)) {
    pushObjectCandidate(rawDataNode.item)
    pushObjectCandidate(rawDataNode.output_item)
  }

  const nestedData = getNestedRecord(payload, 'data')
  if (nestedData) {
    pushObjectCandidate(nestedData.item)
    pushObjectCandidate(nestedData.output_item)
  }

  return extractImages(candidateNodes)
}

async function parseResponseSseStream(response: Response): Promise<StreamParseResult> {
  if (!response.body) {
    throw new Error('流式响应缺少可读取的消息体')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const rawBlocks: string[] = []
  const parsedEvents: unknown[] = []
  const textFragments: string[] = []
  const imagesBySrc = new Map<string, StudioImage>()
  const eventTypes = new Set<string>()
  const events: StreamEventTrace[] = []
  let hasOutputItemDone = false
  let buffer = ''
  let fullText = ''

  const addImages = (items: StudioImage[]) => {
    for (const image of items) {
      if (!image.src || imagesBySrc.has(image.src)) {
        continue
      }
      imagesBySrc.set(image.src, image)
    }
  }

  const processBlock = (block: string) => {
    const trimmedBlock = block.trim()
    if (!trimmedBlock) {
      return
    }

    rawBlocks.push(trimmedBlock)
    const lines = trimmedBlock.split('\n')
    let eventType = ''
    const dataLines: string[] = []

    for (const line of lines) {
      const normalizedLine = line.trimStart()
      if (normalizedLine.startsWith('event:')) {
        eventType = normalizedLine.slice(6).trim()
        continue
      }
      if (normalizedLine.startsWith('data:')) {
        dataLines.push(normalizedLine.slice(5).trimStart())
      }
    }

    if (dataLines.length === 0) {
      return
    }

    const dataText = dataLines.join('\n').trim()
    if (!dataText || dataText === '[DONE]') {
      return
    }

    const payload = safeJsonParse(dataText)
    parsedEvents.push(payload)
    if (eventType) {
      eventTypes.add(eventType)
      if (eventType === 'response.output_item.done') {
        hasOutputItemDone = true
      }
    }

    if (typeof payload === 'string') {
      textFragments.push(payload)
      events.push({
        at: new Date().toISOString(),
        type: eventType || 'message',
        preview: payload.slice(0, 220),
      })
      return
    }

    if (isRecord(payload)) {
      const payloadType = typeof payload.type === 'string' ? payload.type.trim() : ''
      const payloadEvent = typeof payload.event === 'string' ? payload.event.trim() : ''
      const nestedData = parseJsonLikeString(payload.data)
      const nestedType = isRecord(nestedData) && typeof nestedData.type === 'string' ? nestedData.type.trim() : ''
      const nestedEvent =
        isRecord(nestedData) && typeof nestedData.event === 'string' ? nestedData.event.trim() : ''

      for (const candidate of [payloadType, payloadEvent, nestedType, nestedEvent]) {
        if (!candidate) {
          continue
        }
        eventTypes.add(candidate)
        if (candidate === 'response.output_item.done') {
          hasOutputItemDone = true
        }
      }
    }
    events.push({
      at: new Date().toISOString(),
      type: eventType || (isRecord(payload) && typeof payload.type === 'string' ? payload.type : 'event'),
      preview:
        typeof payload === 'string'
          ? payload.slice(0, 220)
          : JSON.stringify(payload).slice(0, 220),
    })

    addImages(extractImagesFromOutputItemDoneEvent(eventType, payload))

    if (isRecord(payload)) {
      const delta = payload.delta
      if (typeof delta === 'string' && delta.trim()) {
        textFragments.push(delta)
      }
      const text = payload.text
      if (typeof text === 'string' && text.trim()) {
        textFragments.push(text)
      }
      const outputTextDelta = payload.output_text_delta
      if (typeof outputTextDelta === 'string' && outputTextDelta.trim()) {
        textFragments.push(outputTextDelta)
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    const chunkText = decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const normalizedChunk = chunkText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    fullText += normalizedChunk
    buffer += normalizedChunk

    let markerIndex = buffer.indexOf('\n\n')
    while (markerIndex >= 0) {
      const block = buffer.slice(0, markerIndex)
      buffer = buffer.slice(markerIndex + 2)
      processBlock(block)
      markerIndex = buffer.indexOf('\n\n')
    }

    if (done) {
      break
    }
  }

  const tail = buffer.trim()
  if (tail) {
    processBlock(tail)
  }

  if (imagesBySrc.size === 0) {
    addImages(extractImages(parsedEvents))
  }

  if (parsedEvents.length === 0 && fullText.trim()) {
    const fallbackPayload = safeJsonParse(fullText)
    parsedEvents.push(fallbackPayload)
    addImages(extractImages([fallbackPayload]))
  }

  const outputText = textFragments.join('').trim() || extractText(parsedEvents)
  const rawSource = rawBlocks.length > 0 ? rawBlocks.join('\n\n') : fullText
  const raw = rawSource.slice(0, 200000)
  return {
    images: Array.from(imagesBySrc.values()),
    outputText,
    raw,
    eventTypes: Array.from(eventTypes.values()),
    hasOutputItemDone,
    events: events.slice(-200),
  }
}

function extractText(payload: unknown): string {
  const snippets: string[] = []
  const visited = new Set<unknown>()

  const pushSnippet = (value: string) => {
    const text = value.trim()
    if (text.length < 2 || looksLikeImageUrl(text)) {
      return
    }
    if (!snippets.includes(text)) {
      snippets.push(text)
    }
  }

  const walk = (node: unknown) => {
    if (snippets.length >= 12) {
      return
    }

    if (typeof node === 'string') {
      pushSnippet(node)
      return
    }

    if (!isRecord(node) && !Array.isArray(node)) {
      return
    }

    if (visited.has(node)) {
      return
    }
    visited.add(node)

    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    const preferredKeys = ['output_text', 'text', 'message', 'content', 'response']
    for (const key of preferredKeys) {
      const value = node[key]
      if (typeof value === 'string') {
        pushSnippet(value)
      }
    }

    Object.values(node).forEach(walk)
  }

  walk(payload)
  return snippets.join('\n').slice(0, 6000)
}

function extractImages(payload: unknown): StudioImage[] {
  const images = new Map<string, StudioImage>()
  const visited = new Set<unknown>()
  let index = 0

  const addImage = (src: string, mimeType = 'image/png') => {
    const normalized = src.trim()
    if (!normalized || images.has(normalized)) {
      return
    }
    images.set(normalized, {
      id: `img-${Date.now()}-${index}`,
      src: normalized,
      mimeType,
    })
    index += 1
  }

  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      const parsedNode = parseJsonLikeString(node)
      if (parsedNode !== node) {
        walk(parsedNode)
        return
      }
      if (looksLikeImageUrl(node) || node.startsWith('data:image/')) {
        addImage(node)
      }
      return
    }

    if (!isRecord(node) && !Array.isArray(node)) {
      return
    }

    if (visited.has(node)) {
      return
    }
    visited.add(node)

    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    const urlValue = node.url
    if (typeof urlValue === 'string' && (looksLikeImageUrl(urlValue) || urlValue.startsWith('data:image/'))) {
      addImage(urlValue)
    }

    const mimeType = typeof node.mimeType === 'string' ? node.mimeType : undefined
    const nodeType = typeof node.type === 'string' ? node.type : undefined

    if (nodeType === 'image_generation_call') {
      const result = node.result
      const resultMimeType =
        typeof node.mime_type === 'string'
          ? node.mime_type
          : typeof node.output_format === 'string' && node.output_format.toLowerCase() === 'jpeg'
            ? 'image/jpeg'
            : mimeType

      if (typeof result === 'string') {
        const parsedResult = parseJsonLikeString(result)
        if (parsedResult !== result) {
          walk(parsedResult)
        } else if (result.length > 40) {
          if (result.startsWith('data:image/')) {
            addImage(result, resultMimeType ?? 'image/png')
          } else {
            addImage(makeDataUrl(result, resultMimeType), resultMimeType ?? 'image/png')
          }
        }
      }
    }

    const inlineData = node.inlineData
    if (isRecord(inlineData)) {
      const data = inlineData.data
      const inlineMime = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : mimeType
      if (typeof data === 'string' && data.length > 40) {
        addImage(makeDataUrl(data, inlineMime), inlineMime ?? 'image/png')
      }
    }

    const inlineDataSnake = node.inline_data
    if (isRecord(inlineDataSnake)) {
      const data = inlineDataSnake.data
      const inlineMime =
        typeof inlineDataSnake.mime_type === 'string'
          ? inlineDataSnake.mime_type
          : mimeType
      if (typeof data === 'string' && data.length > 40) {
        addImage(makeDataUrl(data, inlineMime), inlineMime ?? 'image/png')
      }
    }

    const base64Keys = ['b64_json', 'b64', 'image_base64', 'base64']
    for (const key of base64Keys) {
      const value = node[key]
      if (typeof value === 'string' && value.length > 40) {
        addImage(makeDataUrl(value, mimeType), mimeType ?? 'image/png')
      }
    }

    Object.values(node).forEach(walk)
  }

  walk(payload)
  return Array.from(images.values())
}

function extractError(payload: unknown, status: number): string {
  if (typeof payload === 'string') {
    return `HTTP ${status}: ${payload.slice(0, 200)}`
  }

  if (isRecord(payload)) {
    const errorField = payload.error
    if (typeof errorField === 'string') {
      return `HTTP ${status}: ${errorField}`
    }
    if (isRecord(errorField)) {
      const messageField = errorField.message
      if (typeof messageField === 'string') {
        return `HTTP ${status}: ${messageField}`
      }
    }
  }

  const fallback = extractText(payload)
  if (fallback) {
    return `HTTP ${status}: ${fallback.slice(0, 220)}`
  }
  return `HTTP ${status}: 请求失败`
}

function isLikelyFetchNetworkError(message: string): boolean {
  return /networkerror|failed to fetch|load failed|network request failed|fetch resource/i.test(
    message,
  )
}

function composePrompt(
  config: GenerationConfig,
  mode: StudioMode,
  source: ImageSourceState,
  maskEditor?: MaskEditorState,
): string {
  const blocks: string[] = [config.prompt.trim()]

  if (config.style !== 'auto') {
    blocks.push(`风格建议：${config.style}`)
  }
  if (config.negativePrompt.trim()) {
    blocks.push(`负向限制：${config.negativePrompt.trim()}`)
  }

  blocks.push(
    `输出设置：分辨率 ${config.resolution}，长宽比 ${config.aspectRatio}，格式 ${config.outputFormat}，质量 ${config.quality}。`,
  )

  if (mode === 'image-to-image') {
    blocks.push(
      `这是图生图任务，请在保留主体结构的同时进行高质量重绘，参考强度 ${config.strength.toFixed(2)}。`,
    )
    if (source.imageUrl.trim()) {
      blocks.push(`参考图 URL：${source.imageUrl.trim()}`)
    }
    if (maskEditor?.enabled) {
      blocks.push(
        maskEditor.protectMode === 'keep-center'
          ? '局部重绘策略：优先保留主体中心区域，仅扩展或重绘边缘细节。'
          : '局部重绘策略：优先重绘主体中心区域，尽量保持边缘背景结构。',
      )
      if (maskEditor.maskNote.trim()) {
        blocks.push(`局部重绘备注：${maskEditor.maskNote.trim()}`)
      }
    }
  }

  return blocks.filter(Boolean).join('\n')
}

function buildModelCandidates(provider: Provider, currentModel: string): string[] {
  const candidates =
    provider === 'openai'
      ? [currentModel]
      : [currentModel, ...IMAGE_MODEL_FALLBACK_MODELS]
  const unique: string[] = []

  for (const candidate of candidates) {
    const model = candidate.trim()
    if (!model) {
      continue
    }
    if (unique.some((item) => item.toLowerCase() === model.toLowerCase())) {
      continue
    }
    unique.push(model)
  }

  return unique
}

function parsePromptList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('#') && !line.startsWith('//'))
}

function buildBatchPromptQueue(config: BatchConfig, singlePrompt: string): string[] {
  const cleanedPrompt = singlePrompt.trim()
  if (config.mode === 'prompt-list') {
    return parsePromptList(config.promptList)
  }
  if (config.mode === 'reroll') {
    if (!cleanedPrompt) {
      return []
    }
    const count = Math.max(1, Math.min(20, Math.floor(config.rerollCount)))
    return Array.from({ length: count }, () => cleanedPrompt)
  }
  return cleanedPrompt ? [cleanedPrompt] : []
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('文件读取失败'))
        return
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

async function optimizeImageForModelInput(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const fallbackMimeType = file.type || 'image/png'
  const fallback = async () => ({
    base64: await fileToBase64(file),
    mimeType: fallbackMimeType,
  })

  if (typeof document === 'undefined') {
    return fallback()
  }

  try {
    const bitmap = await createImageBitmap(file)
    const maxEdge = Math.max(bitmap.width, bitmap.height)
    const needsDownscale = maxEdge > MAX_IMAGE_INPUT_EDGE
    const unsupportedMime = !SUPPORTED_IMAGE_INPUT_MIME_TYPES.has(file.type)
    const needsSizeReduction = file.size > MAX_IMAGE_INPUT_BYTES

    if (!needsDownscale && !unsupportedMime && !needsSizeReduction) {
      bitmap.close()
      return fallback()
    }

    const scale = needsDownscale ? MAX_IMAGE_INPUT_EDGE / maxEdge : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return fallback()
    }

    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const outputMimeType =
      file.type === 'image/png' && !needsSizeReduction && !unsupportedMime ? 'image/png' : 'image/jpeg'
    const outputQuality = outputMimeType === 'image/jpeg' ? 0.9 : undefined

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (candidate) => {
          if (!candidate) {
            reject(new Error('图片压缩失败'))
            return
          }
          resolve(candidate)
        },
        outputMimeType,
        outputQuality,
      )
    })

    const normalizedFileName = outputMimeType === 'image/jpeg' ? 'upload.jpg' : 'upload.png'
    const normalizedFile = new File([blob], normalizedFileName, { type: outputMimeType })
    return {
      base64: await fileToBase64(normalizedFile),
      mimeType: outputMimeType,
    }
  } catch {
    return fallback()
  }
}

async function prepareRequest(
  mode: StudioMode,
  connection: ConnectionConfig,
  generation: GenerationConfig,
  source: ImageSourceState,
  modelOverride?: string,
  promptOverride?: string,
  options?: {
    generationOverride?: Partial<GenerationConfig>
    baseUrlOverride?: string
    maskEditor?: MaskEditorState
  },
): Promise<PreparedRequest> {
  const apiKey = connection.apiKey.trim()
  const extraHeaders = parseExtraHeaders(connection.extraHeaders)
  const effectiveGeneration =
    typeof promptOverride === 'string'
      ? {
          ...generation,
          prompt: promptOverride,
        }
      : generation
  const mergedGeneration =
    options?.generationOverride
      ? {
          ...effectiveGeneration,
          ...options.generationOverride,
        }
      : effectiveGeneration
  const prompt = composePrompt(mergedGeneration, mode, source, options?.maskEditor)
  const runtimeBaseUrl = resolveRuntimeBaseUrl(options?.baseUrlOverride ?? connection.baseUrl)
  const requestedModel = (modelOverride ?? connection.model).trim()

  if (connection.provider === 'openai') {
    const endpointPath = mode === 'text-to-image' ? connection.openaiTextPath : connection.openaiEditPath
    const endpoint = buildUrl(runtimeBaseUrl, endpointPath)
    const useResponsesApi = isResponsesEndpoint(endpoint)
    const headers: Record<string, string> = { ...extraHeaders }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    if (useResponsesApi) {
      const content: Array<Record<string, string>> = [{ type: 'input_text', text: prompt }]

      if (mode === 'image-to-image') {
        if (source.file) {
          const optimizedInput = await optimizeImageForModelInput(source.file)
          content.push({
            type: 'input_image',
            image_url: `data:${optimizedInput.mimeType};base64,${optimizedInput.base64}`,
          })
        } else if (source.imageUrl.trim()) {
          content.push({
            type: 'input_image',
            image_url: source.imageUrl.trim(),
          })
        } else {
          throw new Error('图生图模式至少需要上传一张参考图或填写参考图 URL')
        }
      }

      const payload = {
        model: requestedModel,
        stream: true,
        input: [
          {
            role: 'user',
            content,
          },
        ],
        tool_choice: {
          type: 'image_generation',
        },
        tools: [
          {
            type: 'image_generation',
            model: OPENAI_IMAGE_TOOL_MODEL,
          },
        ],
      }

      const requestPreview = JSON.stringify(payload, null, 2)
      return {
        endpoint,
        requestPreview,
        expectsSse: true,
        init: {
          method: 'POST',
          headers: {
            ...headers,
            Accept: 'text/event-stream, application/json',
            'Content-Type': 'application/json',
          },
          body: requestPreview,
        },
      }
    }

    const basePayload: Record<string, unknown> = {
      model: requestedModel,
      prompt,
      n: mergedGeneration.imageCount,
      size: mergedGeneration.resolution,
      quality: mergedGeneration.quality,
      output_format: mergedGeneration.outputFormat,
      background: mergedGeneration.background,
    }

    if (mergedGeneration.seed !== null) {
      basePayload.seed = mergedGeneration.seed
    }

    if (mode === 'text-to-image') {
      const requestPreview = JSON.stringify(basePayload, null, 2)
      return {
        endpoint,
        requestPreview,
        init: {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: requestPreview,
        },
      }
    }

    if (source.file) {
      const formData = new FormData()
      formData.set('model', requestedModel)
      formData.set('prompt', prompt)
      formData.set('n', String(mergedGeneration.imageCount))
      formData.set('size', mergedGeneration.resolution)
      formData.set('quality', mergedGeneration.quality)
      formData.set('output_format', mergedGeneration.outputFormat)
      formData.set('background', mergedGeneration.background)
      formData.set('strength', mergedGeneration.strength.toFixed(2))
      formData.set('image', source.file)
      if (mergedGeneration.seed !== null) {
        formData.set('seed', String(mergedGeneration.seed))
      }
      if (source.imageUrl.trim()) {
        formData.set('image_url', source.imageUrl.trim())
      }

      return {
        endpoint,
        requestPreview:
          'multipart/form-data: image(file) + model + prompt + n + size + quality + output_format + background + strength',
        init: {
          method: 'POST',
          headers,
          body: formData,
        },
      }
    }

    if (source.imageUrl.trim()) {
      basePayload.image_url = source.imageUrl.trim()
      basePayload.strength = Number(mergedGeneration.strength.toFixed(2))
      const requestPreview = JSON.stringify(basePayload, null, 2)
      return {
        endpoint,
        requestPreview,
        init: {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: requestPreview,
        },
      }
    }

    throw new Error('图生图模式至少需要上传一张参考图或填写参考图 URL')
  }

  const model = requestedModel
  const rawPath = connection.geminiPathTemplate.replace('{model}', model)
  let endpoint = buildUrl(runtimeBaseUrl, rawPath)

  const headers: Record<string, string> = {
    ...extraHeaders,
    'Content-Type': 'application/json',
  }

  if (connection.authMode === 'query') {
    endpoint = withQueryParam(endpoint, 'key', apiKey)
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const parts: Array<Record<string, unknown>> = []

  if (mode === 'image-to-image') {
    if (source.file) {
      const optimizedInput = await optimizeImageForModelInput(source.file)
      parts.push({
        inlineData: {
          mimeType: optimizedInput.mimeType,
          data: optimizedInput.base64,
        },
      })
    } else if (source.imageUrl.trim()) {
      parts.push({
        fileData: {
          mimeType: 'image/png',
          fileUri: source.imageUrl.trim(),
        },
      })
    } else {
      throw new Error('图生图模式至少需要上传一张参考图或填写参考图 URL')
    }
  }

  parts.push({ text: prompt })

  const generationConfig: Record<string, unknown> = {
    temperature: mergedGeneration.temperature,
    candidateCount: mergedGeneration.imageCount,
    responseModalities: ['TEXT', 'IMAGE'],
  }

  if (mergedGeneration.aspectRatio !== 'auto') {
    generationConfig.aspectRatio = mergedGeneration.aspectRatio
  }
  if (mergedGeneration.seed !== null) {
    generationConfig.seed = mergedGeneration.seed
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig,
  }

  const requestPreview = JSON.stringify(payload, null, 2)
  return {
    endpoint,
    requestPreview,
    init: {
      method: 'POST',
      headers,
      body: requestPreview,
    },
  }
}

async function downloadImage(image: StudioImage): Promise<void> {
  const response = await fetch(image.src)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const extension = image.mimeType.includes('jpeg')
    ? 'jpg'
    : image.mimeType.includes('webp')
      ? 'webp'
      : 'png'
  anchor.href = objectUrl
  anchor.download = `aurora-${Date.now()}.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

function App() {
  const [mode, setMode] = useState<StudioMode>('text-to-image')
  const [connection, setConnection] = useState<ConnectionConfig>(() =>
    normalizeConnectionDefaults(readStoredObject(CONNECTION_KEY, DEFAULT_CONNECTION)),
  )
  const [generation, setGeneration] = useState<GenerationConfig>(() =>
    readStoredObject(GENERATION_KEY, DEFAULT_GENERATION),
  )
  const [batchConfig, setBatchConfig] = useState<BatchConfig>(() =>
    readStoredObject(BATCH_KEY, DEFAULT_BATCH),
  )
  const [promptTemplateStore, setPromptTemplateStore] = useState<PromptTemplateStore>(() =>
    readStoredPromptTemplateStore(),
  )
  const [presets, setPresets] = useState<ParameterPreset[]>(() => readStoredPresets())
  const [usageStore, setUsageStore] = useState<UsageStore>(() => readUsageStore())
  const [runtimeConfig, setRuntimeConfig] = useState<GenerateRuntimeConfig>(() =>
    readStoredObject(RUNTIME_KEY, DEFAULT_RUNTIME_CONFIG),
  )
  const [queueTasks, setQueueTasks] = useState<QueueTask[]>([])
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>(DEFAULT_HISTORY_FILTER)
  const [historySelection, setHistorySelection] = useState<string[]>([])
  const [historyFolderInput, setHistoryFolderInput] = useState('默认')
  const [historyTagsInput, setHistoryTagsInput] = useState('')
  const [imageReviews, setImageReviews] = useState<Record<string, ImageReview>>({})
  const [workspaceProfiles, setWorkspaceProfiles] = useState<WorkspaceProfile[]>(() =>
    readWorkspaceProfiles(),
  )
  const [workspaceNameInput, setWorkspaceNameInput] = useState('')
  const [sseEvents, setSseEvents] = useState<StreamEventTrace[]>([])
  const [maskEditor, setMaskEditor] = useState<MaskEditorState>(DEFAULT_MASK_EDITOR)
  const [importPromptText, setImportPromptText] = useState('')
  const [layoutCompact, setLayoutCompact] = useState(false)
  const [leftPanePercent, setLeftPanePercent] = useState(44)
  const [showOnlyKeptImages, setShowOnlyKeptImages] = useState(false)
  const [uploadAnalysis, setUploadAnalysis] = useState<UploadAnalysis | null>(null)
  const [templateScope, setTemplateScope] = useState<PromptTemplateScope>('all')
  const [templateCategory, setTemplateCategory] = useState<string>('all')
  const [templateQuery, setTemplateQuery] = useState('')
  const [source, setSource] = useState<ImageSourceState>({
    file: null,
    previewUrl: '',
    imageUrl: '',
  })
  const [images, setImages] = useState<StudioImage[]>([])
  const [runState, setRunState] = useState<RunState>(INITIAL_RUN_STATE)
  const [requestPreview, setRequestPreview] = useState('')
  const [responseText, setResponseText] = useState('')
  const [rawResponse, setRawResponse] = useState('')
  const [history, setHistory] = useState<HistoryRecord[]>(() => readStoredHistory())
  const [isGenerating, setIsGenerating] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [previewImage, setPreviewImage] = useState<StudioImage | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const previewUrlRef = useRef<string>('')
  const hotkeyGenerateRef = useRef<() => Promise<void>>(async () => {})
  const hotkeyCancelRef = useRef<() => void>(() => {})
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    safeLocalStorageSet(CONNECTION_KEY, JSON.stringify(connection))
  }, [connection])

  useEffect(() => {
    safeLocalStorageSet(GENERATION_KEY, JSON.stringify(generation))
  }, [generation])

  useEffect(() => {
    safeLocalStorageSet(BATCH_KEY, JSON.stringify(batchConfig))
  }, [batchConfig])

  useEffect(() => {
    safeLocalStorageSet(PROMPT_TEMPLATE_KEY, JSON.stringify(promptTemplateStore))
  }, [promptTemplateStore])

  useEffect(() => {
    safeLocalStorageSet(PRESET_KEY, JSON.stringify(presets))
  }, [presets])

  useEffect(() => {
    safeLocalStorageSet(USAGE_KEY, JSON.stringify(usageStore))
  }, [usageStore])

  useEffect(() => {
    safeLocalStorageSet(RUNTIME_KEY, JSON.stringify(runtimeConfig))
  }, [runtimeConfig])

  useEffect(() => {
    safeLocalStorageSet(WORKSPACE_KEY, JSON.stringify(workspaceProfiles))
  }, [workspaceProfiles])

  useEffect(() => {
    safeLocalStorageSet(HISTORY_KEY, JSON.stringify(sanitizeHistoryForStorage(history)))
  }, [history])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash || ''
    if (!hash.startsWith('#share=')) {
      return
    }
    const encoded = hash.slice('#share='.length)
    try {
      const decoded = decodeURIComponent(escape(atob(encoded)))
      const payload = safeJsonParse(decoded)
      if (isRecord(payload)) {
        if (isRecord(payload.generation)) {
          setGeneration((previous) => ({ ...previous, ...(payload.generation as Partial<GenerationConfig>) }))
        }
        if (isRecord(payload.batch)) {
          setBatchConfig((previous) => ({ ...previous, ...(payload.batch as Partial<BatchConfig>) }))
        }
        messageApi.success('已从分享链接恢复参数（只读）')
      }
    } catch {
      // Ignore invalid share payload
    }
  }, [messageApi])

  const providerModelOptions = useMemo(
    () => (connection.provider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS),
    [connection.provider],
  )

  const batchQueuePreview = useMemo(
    () => buildBatchPromptQueue(batchConfig, generation.prompt),
    [batchConfig, generation.prompt],
  )

  const normalizedRerollCount = useMemo(
    () => Math.max(1, Math.min(20, Math.floor(batchConfig.rerollCount))),
    [batchConfig.rerollCount],
  )

  const generateButtonLabel = useMemo(() => {
    if (batchConfig.mode === 'prompt-list') {
      return `批量生成 ${batchQueuePreview.length > 0 ? `(${batchQueuePreview.length})` : ''}`.trim()
    }
    if (batchConfig.mode === 'reroll') {
      return `抽卡生成 x${normalizedRerollCount}`
    }
    return '开始生成'
  }, [batchConfig.mode, batchQueuePreview.length, normalizedRerollCount])

  const isGenerateDisabled = useMemo(() => {
    if (isGenerating) {
      return true
    }
    return batchConfig.mode === 'prompt-list' && batchQueuePreview.length === 0
  }, [batchConfig.mode, batchQueuePreview.length, isGenerating])

  const endpointPreview = useMemo(() => {
    if (!connection.baseUrl.trim()) {
      return '请先填写 Base URL'
    }
    const runtimeBaseUrl = resolveRuntimeBaseUrl(connection.baseUrl)
    if (connection.provider === 'openai') {
      const path = mode === 'text-to-image' ? connection.openaiTextPath : connection.openaiEditPath
      return buildUrl(runtimeBaseUrl, path)
    }
    const path = connection.geminiPathTemplate.replace('{model}', connection.model.trim())
    return buildUrl(runtimeBaseUrl, path)
  }, [connection, mode])

  const todayUsage = useMemo(() => {
    const today = getTodayStamp()
    return (
      usageStore.days.find((item) => item.date === today) ?? {
        date: today,
        requests: 0,
        images: 0,
        estimatedCostUsd: 0,
      }
    )
  }, [usageStore.days])

  const historyHealth = useMemo(() => {
    if (history.length === 0) {
      return {
        successRate: 0,
        avgLatencyMs: 0,
        errors24h: 0,
      }
    }
    const successCount = history.filter((item) => item.status === 'success').length
    const latencies = history
      .map((item) => item.latencyMs)
      .filter((item): item is number => typeof item === 'number' && item > 0)
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : 0
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const errors24h = history.filter(
      (item) => item.status === 'error' && new Date(item.createdAt).getTime() >= oneDayAgo,
    ).length
    return {
      successRate: Math.round((successCount / history.length) * 100),
      avgLatencyMs,
      errors24h,
    }
  }, [history])

  const filteredHistory = useMemo(() => {
    const keyword = historyFilter.keyword.trim().toLowerCase()
    const folderKeyword = historyFilter.folder.trim().toLowerCase()
    const fromTime = historyFilter.fromDate ? new Date(`${historyFilter.fromDate}T00:00:00`).getTime() : 0
    const toTime = historyFilter.toDate ? new Date(`${historyFilter.toDate}T23:59:59`).getTime() : 0
    return history.filter((item) => {
      if (historyFilter.status !== 'all' && item.status !== historyFilter.status) {
        return false
      }
      if (historyFilter.mode !== 'all' && item.mode !== historyFilter.mode) {
        return false
      }
      const folder = (item.folder ?? '').toLowerCase()
      if (folderKeyword && !folder.includes(folderKeyword)) {
        return false
      }
      if (keyword) {
        const haystack = [item.prompt, item.model, item.note, (item.tags ?? []).join(' ')].join(' ').toLowerCase()
        if (!haystack.includes(keyword)) {
          return false
        }
      }
      const time = new Date(item.createdAt).getTime()
      if (fromTime && time < fromTime) {
        return false
      }
      if (toTime && time > toTime) {
        return false
      }
      return true
    })
  }, [history, historyFilter])

  const visibleImages = useMemo(() => {
    if (!showOnlyKeptImages) {
      return images
    }
    return images.filter((image) => imageReviews[image.src]?.decision === 'keep')
  }, [images, imageReviews, showOnlyKeptImages])

  const promptTemplateById = useMemo(
    () => new Map(PROMPT_TEMPLATE_LIBRARY.map((item) => [item.id, item])),
    [],
  )

  const quickPromptTemplates = useMemo(() => {
    const list: PromptTemplate[] = []
    for (const id of QUICK_TEMPLATE_IDS) {
      const item = promptTemplateById.get(id)
      if (item) {
        list.push(item)
      }
    }
    return list
  }, [promptTemplateById])

  const promptTemplateCategories = useMemo(() => {
    const categorySet = new Set(PROMPT_TEMPLATE_LIBRARY.map((item) => item.category))
    return ['all', ...Array.from(categorySet)]
  }, [])

  const favoriteTemplateSet = useMemo(
    () => new Set(promptTemplateStore.favorites),
    [promptTemplateStore.favorites],
  )

  const recentTemplateSet = useMemo(
    () => new Set(promptTemplateStore.recent),
    [promptTemplateStore.recent],
  )

  const filteredPromptTemplates = useMemo(() => {
    const keyword = templateQuery.trim().toLowerCase()
    return PROMPT_TEMPLATE_LIBRARY.filter((template) => {
      if (templateScope === 'favorites' && !favoriteTemplateSet.has(template.id)) {
        return false
      }
      if (templateScope === 'recent' && !recentTemplateSet.has(template.id)) {
        return false
      }
      if (templateCategory !== 'all' && template.category !== templateCategory) {
        return false
      }
      if (!keyword) {
        return true
      }
      const searchText = [
        template.label,
        template.category,
        template.prompt,
        template.negativePrompt ?? '',
        template.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return searchText.includes(keyword)
    })
  }, [favoriteTemplateSet, recentTemplateSet, templateCategory, templateQuery, templateScope])

  const recentPromptTemplates = useMemo(() => {
    const list: PromptTemplate[] = []
    for (const templateId of promptTemplateStore.recent) {
      const matched = promptTemplateById.get(templateId)
      if (matched) {
        list.push(matched)
      }
      if (list.length >= 6) {
        break
      }
    }
    return list
  }, [promptTemplateById, promptTemplateStore.recent])

  const applyPromptTemplate = (template: PromptTemplate) => {
    setGeneration((previous) => ({
      ...previous,
      prompt: template.prompt,
      negativePrompt: template.negativePrompt ?? previous.negativePrompt,
      style:
        previous.style === 'auto'
          ? template.recommendedStyle ?? 'cinematic'
          : previous.style,
    }))
    setPromptTemplateStore((previous) => ({
      ...previous,
      recent: [template.id, ...previous.recent.filter((item) => item !== template.id)].slice(0, 20),
    }))
    messageApi.success(`已套用模板：${template.label}`)
  }

  const toggleFavoriteTemplate = (templateId: string) => {
    setPromptTemplateStore((previous) => {
      const isFavorited = previous.favorites.includes(templateId)
      return {
        ...previous,
        favorites: isFavorited
          ? previous.favorites.filter((item) => item !== templateId)
          : [templateId, ...previous.favorites].slice(0, 40),
      }
    })
  }

  const saveCurrentPreset = () => {
    const name = window.prompt('输入参数预设名称', `预设-${new Date().toLocaleTimeString()}`)?.trim()
    if (!name) {
      return
    }
    setPresets((previous) => {
      const duplicate = previous.find((item) => item.name === name)
      if (duplicate) {
        return previous.map((item) =>
          item.id === duplicate.id
            ? {
                ...item,
                generation: generation,
                batch: batchConfig,
              }
            : item,
        )
      }
      return [
        {
          id: crypto.randomUUID(),
          name,
          generation,
          batch: batchConfig,
        },
        ...previous,
      ].slice(0, 30)
    })
    messageApi.success(`已保存参数预设：${name}`)
  }

  const applyPreset = (presetId: string) => {
    const matched = presets.find((item) => item.id === presetId)
    if (!matched) {
      return
    }
    setGeneration(matched.generation)
    setBatchConfig(matched.batch)
    messageApi.success(`已套用预设：${matched.name}`)
  }

  const removePreset = (presetId: string) => {
    const matched = presets.find((item) => item.id === presetId)
    setPresets((previous) => previous.filter((item) => item.id !== presetId))
    if (matched) {
      messageApi.success(`已删除预设：${matched.name}`)
    }
  }

  const saveWorkspaceProfile = () => {
    const name = workspaceNameInput.trim() || `空间-${new Date().toLocaleTimeString()}`
    setWorkspaceProfiles((previous) => [
      {
        id: crypto.randomUUID(),
        name,
        connection,
        generation,
        batch: batchConfig,
      },
      ...previous,
    ].slice(0, 20))
    setWorkspaceNameInput('')
    messageApi.success(`已保存协作空间：${name}`)
  }

  const applyWorkspaceProfile = (profileId: string) => {
    const profile = workspaceProfiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }
    setConnection(profile.connection)
    setGeneration(profile.generation)
    setBatchConfig(profile.batch)
    messageApi.success(`已切换到空间：${profile.name}`)
  }

  const deleteWorkspaceProfile = (profileId: string) => {
    setWorkspaceProfiles((previous) => previous.filter((item) => item.id !== profileId))
  }

  const exportReadonlyShareLink = () => {
    const payload = {
      generation,
      batch: batchConfig,
      prompt: generation.prompt,
      createdAt: new Date().toISOString(),
    }
    try {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`
      void navigator.clipboard
        .writeText(url)
        .then(() => messageApi.success('只读分享链接已复制'))
        .catch(() => messageApi.error('复制失败，请手动复制'))
    } catch {
      messageApi.error('生成分享链接失败')
    }
  }

  const importPromptLines = () => {
    const prompts = parsePromptImport(importPromptText)
    if (prompts.length === 0) {
      messageApi.error('未解析到可用提示词，请粘贴 TXT/CSV/JSON 内容')
      return
    }
    setBatchConfig((previous) => ({
      ...previous,
      mode: 'prompt-list',
      promptList: prompts.join('\n'),
    }))
    messageApi.success(`已导入 ${prompts.length} 条提示词`)
  }

  const updateImageReview = (
    image: StudioImage,
    patch: Partial<ImageReview>,
  ) => {
    setImageReviews((previous) => {
      const current = previous[image.src] ?? {
        rating: 0,
        note: '',
        decision: 'unrated' as ImageDecision,
      }
      return {
        ...previous,
        [image.src]: {
          ...current,
          ...patch,
        },
      }
    })
  }

  const clearHistorySelection = () => {
    setHistorySelection([])
  }

  const deleteSelectedHistory = () => {
    if (historySelection.length === 0) {
      messageApi.warning('请先选择历史记录')
      return
    }
    setHistory((previous) => previous.filter((item) => !historySelection.includes(item.id)))
    setHistorySelection([])
    messageApi.success(`已删除 ${historySelection.length} 条历史记录`)
  }

  const exportProjectZip = async () => {
    try {
      const files: Array<{ name: string; data: Uint8Array }> = []
      const manifest: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        generation,
        batch: batchConfig,
        history: filteredHistory.slice(0, 60),
        images: images.map((image) => ({
          src: image.src,
          mimeType: image.mimeType,
          review: imageReviews[image.src] ?? null,
        })),
      }
      files.push({
        name: 'project.json',
        data: utf8Bytes(JSON.stringify(manifest, null, 2)),
      })

      let downloaded = 0
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index]
        try {
          const response = await fetch(image.src)
          const blob = await response.blob()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const extension = image.mimeType.includes('jpeg')
            ? 'jpg'
            : image.mimeType.includes('webp')
              ? 'webp'
              : 'png'
          files.push({
            name: `images/${String(index + 1).padStart(3, '0')}.${extension}`,
            data: bytes,
          })
          downloaded += 1
        } catch {
          // Cross-origin or dead URL can fail; manifest already keeps original URL.
        }
      }

      const zipBytes = makeZip(files)
      const zipBuffer = new ArrayBuffer(zipBytes.byteLength)
      new Uint8Array(zipBuffer).set(zipBytes)
      const blob = new Blob([zipBuffer], { type: 'application/zip' })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `img-generator-project-${Date.now()}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      messageApi.success(`导出完成：${files.length} 个文件（图片 ${downloaded}/${images.length}）`)
    } catch {
      messageApi.error('导出 ZIP 失败，请稍后重试')
    }
  }

  const handleProviderChange = (nextProvider: string) => {
    if (nextProvider !== 'openai' && nextProvider !== 'gemini') {
      return
    }
    setConnection((previous) => ({
      ...previous,
      provider: nextProvider,
      authMode: nextProvider === 'openai' ? 'bearer' : previous.authMode,
      model: nextProvider === 'openai' ? 'gpt-5.4' : 'nanobanana2',
    }))
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) {
      return
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    const previewUrl = URL.createObjectURL(nextFile)
    previewUrlRef.current = previewUrl
    setSource((previous) => ({
      ...previous,
      file: nextFile,
      previewUrl,
    }))
    setUploadAnalysis({
      mimeType: nextFile.type || 'unknown',
      sizeKb: Math.round(nextFile.size / 1024),
    })
    void (async () => {
      try {
        const bitmap = await createImageBitmap(nextFile)
        setUploadAnalysis({
          mimeType: nextFile.type || 'unknown',
          sizeKb: Math.round(nextFile.size / 1024),
          width: bitmap.width,
          height: bitmap.height,
        })
        bitmap.close()
      } catch {
        // ignore
      }
    })()
  }

  const handleUseAsReferenceImage = (image: StudioImage) => {
    setMode('image-to-image')
    setSource((previous) => ({
      ...previous,
      imageUrl: image.src,
    }))
    messageApi.success('已填入图生图参考图 URL')
  }

  const handleCancel = () => {
    if (!abortRef.current) {
      return
    }
    abortRef.current.abort()
  }

  const appendHistory = (entry: HistoryRecord) => {
    setHistory((previous) => [entry, ...previous].slice(0, 40))
  }

  const handleGenerate = async () => {
    if (!connection.baseUrl.trim()) {
      messageApi.error('请先填写 Base URL')
      return
    }
    if (!connection.apiKey.trim()) {
      messageApi.error('请先填写 API Key')
      return
    }
    if (!connection.model.trim()) {
      messageApi.error('请先填写模型名称')
      return
    }

    const promptQueue = buildBatchPromptQueue(batchConfig, generation.prompt)
    if (batchConfig.mode === 'prompt-list' && promptQueue.length === 0) {
      messageApi.error('批量提示词为空，请每行填写一条提示词')
      return
    }
    if (batchConfig.mode !== 'prompt-list' && !generation.prompt.trim()) {
      messageApi.error('请先填写提示词')
      return
    }

    if (mode === 'image-to-image' && !source.file && !source.imageUrl.trim()) {
      messageApi.error('图生图模式请上传参考图或填写参考图 URL')
      return
    }

    if (runtimeConfig.qualityGuardEnabled) {
      const qualityIssues = validatePromptQuality(generation.prompt, runtimeConfig)
      if (qualityIssues.length > 0) {
        messageApi.error(`质量守门触发：${qualityIssues.join('；')}`)
        return
      }
    }

    const seedExperimentActive = runtimeConfig.enableSeedExperiment && generation.seed !== null
    const totalJobCount = promptQueue.length * (seedExperimentActive ? 2 : 1)
    const predictedImageCount = totalJobCount * Math.max(1, generation.imageCount)
    const estimatedCost = estimateImageCostUsd(
      connection.provider,
      predictedImageCount,
      generation.quality,
    )
    if (todayUsage.images + predictedImageCount > runtimeConfig.dailyImageQuota) {
      messageApi.error(
        `超出今日配额：预计 ${predictedImageCount} 张，今日剩余 ${
          Math.max(0, runtimeConfig.dailyImageQuota - todayUsage.images)
        } 张`,
      )
      return
    }
    if (todayUsage.estimatedCostUsd + estimatedCost > runtimeConfig.dailyBudgetUsd) {
      messageApi.error(
        `超出今日预算：预计 $${estimatedCost.toFixed(2)}，剩余额度 $${Math.max(
          0,
          runtimeConfig.dailyBudgetUsd - todayUsage.estimatedCostUsd,
        ).toFixed(2)}`,
      )
      return
    }

    const baseCandidates = [
      connection.baseUrl,
      ...normalizeUrlLines(runtimeConfig.fallbackBaseUrls),
    ].filter((item, index, list) => item.trim() && list.indexOf(item) === index)

    const historyTags = historyTagsInput
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)

    type GenerationJob = {
      id: string
      prompt: string
      seedLabel: string
      generationOverride?: Partial<GenerationConfig>
    }

    const jobs: GenerationJob[] = []
    for (const prompt of promptQueue) {
      if (seedExperimentActive && generation.seed !== null) {
        jobs.push({
          id: crypto.randomUUID(),
          prompt,
          seedLabel: `seed ${generation.seed}`,
          generationOverride: { seed: generation.seed },
        })
        jobs.push({
          id: crypto.randomUUID(),
          prompt,
          seedLabel: `seed ${generation.seed + runtimeConfig.seedDelta}`,
          generationOverride: { seed: generation.seed + runtimeConfig.seedDelta },
        })
      } else {
        jobs.push({
          id: crypto.randomUUID(),
          prompt,
          seedLabel: generation.seed !== null ? `seed ${generation.seed}` : 'random seed',
        })
      }
    }

    setQueueTasks(
      jobs.map((job) => ({
        id: job.id,
        prompt: job.prompt,
        status: 'pending',
        model: '',
        endpoint: '',
        message: job.seedLabel,
      })),
    )

    setIsGenerating(true)
    setRunState({
      phase: 'running',
      message: '任务已提交，正在等待模型生成图像',
      endpoint: '',
    })
    setResponseText('')
    setRawResponse('')
    setSseEvents([])

    const controller = new AbortController()
    abortRef.current = controller
    const batchStartedAt = performance.now()
    const isBatchRun = jobs.length > 1
    let attemptedModel = connection.model.trim()
    let attemptedEndpoint = endpointPreview
    let attemptedPrompt = jobs[0]?.prompt ?? generation.prompt.trim()
    let lastStatusCode: number | undefined
    let lastAttemptLatencyMs: number | undefined
    const aggregatedImages: StudioImage[] = []
    const textualSummaries: string[] = []

    try {
      for (let taskIndex = 0; taskIndex < jobs.length; taskIndex += 1) {
        const job = jobs[taskIndex]
        const taskPrompt = job.prompt
        attemptedPrompt = taskPrompt
        const modelCandidates = buildModelCandidates(connection.provider, connection.model)
        let taskSucceeded = false
        let taskFailureMessage = ''
        let taskFailureEndpoint = ''

        setQueueTasks((previous) =>
          previous.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  status: 'running',
                  startedAt: performance.now(),
                }
              : item,
          ),
        )

        for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
          const candidateModel = modelCandidates[modelIndex]
          attemptedModel = candidateModel
          for (let baseIndex = 0; baseIndex < baseCandidates.length; baseIndex += 1) {
            const baseCandidate = baseCandidates[baseIndex]
            const attemptStartedAt = performance.now()
            try {
              const request = await prepareRequest(
                mode,
                connection,
                generation,
                source,
                candidateModel,
                taskPrompt,
                {
                  generationOverride: job.generationOverride,
                  baseUrlOverride: baseCandidate,
                  maskEditor,
                },
              )
              attemptedEndpoint = request.endpoint
              taskFailureEndpoint = request.endpoint
              setRequestPreview(request.requestPreview)
              setRunState({
                phase: 'running',
                message: isBatchRun
                  ? `队列 ${taskIndex + 1}/${jobs.length} · ${job.seedLabel} · ${candidateModel}`
                  : modelCandidates.length > 1
                    ? `正在尝试模型 ${candidateModel}（${modelIndex + 1}/${modelCandidates.length}）`
                    : '任务已提交，正在等待模型生成图像',
                endpoint: request.endpoint,
              })
              setQueueTasks((previous) =>
                previous.map((item) =>
                  item.id === job.id
                    ? {
                        ...item,
                        model: candidateModel,
                        endpoint: request.endpoint,
                      }
                    : item,
                ),
              )

              const response = await fetch(request.endpoint, {
                ...request.init,
                signal: controller.signal,
              })
              lastStatusCode = response.status
              lastAttemptLatencyMs = Math.round(performance.now() - attemptStartedAt)
              const responseContentType = (response.headers.get('content-type') ?? '').toLowerCase()
              const shouldParseSse =
                Boolean(request.expectsSse) ||
                responseContentType.includes('text/event-stream') ||
                isResponsesEndpoint(request.endpoint)

              if (!response.ok) {
                const raw = await response.text()
                const payload = safeJsonParse(raw)
                setRawResponse(
                  typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
                )
                const failure = extractError(payload, response.status)
                if (
                  MODEL_UNAVAILABLE_PATTERN.test(failure) &&
                  modelIndex < modelCandidates.length - 1
                ) {
                  const nextModel = modelCandidates[modelIndex + 1]
                  setResponseText(
                    `模型 ${candidateModel} 当前不可用，正在自动切换到 ${nextModel} 重试...`,
                  )
                  break
                }
                taskFailureMessage =
                  mode === 'image-to-image' &&
                  Boolean(source.file) &&
                  INPUT_STREAM_ERROR_PATTERN.test(failure)
                    ? `图生图输入流异常：${failure}。已自动做上传图规范化，若仍失败请改用外链图片 URL 或更小的 JPG/PNG。`
                    : failure
                if (response.status >= 500 || isLikelyFetchNetworkError(failure)) {
                  continue
                }
                break
              }

              let nextImages: StudioImage[] = []
              let outputText = ''
              let raw = ''
              let streamEventTypes: string[] = []
              let streamHasOutputItemDone = false

              if (shouldParseSse) {
                const streamResult = await parseResponseSseStream(response)
                nextImages = streamResult.images
                outputText = streamResult.outputText
                raw = streamResult.raw
                streamEventTypes = streamResult.eventTypes
                streamHasOutputItemDone = streamResult.hasOutputItemDone
                setSseEvents((previous) => [...previous, ...streamResult.events].slice(-800))
                setRawResponse(raw || 'SSE 流式响应已消费，但无可展示原文。')
              } else {
                raw = await response.text()
                const payload = safeJsonParse(raw)
                setRawResponse(
                  typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
                )
                nextImages = extractImages(payload)
                outputText = extractText(payload)
              }

              if (nextImages.length === 0) {
                if (shouldParseSse) {
                  const recentEventTypes =
                    streamEventTypes.length > 0
                      ? streamEventTypes.slice(0, 10).join(', ')
                      : '未解析到事件类型'
                  taskFailureMessage = streamHasOutputItemDone
                    ? `接口返回成功，检测到 response.output_item.done，但事件中未提取到可用图片数据（item.result 可能为空）。事件类型：${recentEventTypes}`
                    : `接口返回成功，但未检测到 response.output_item.done。事件类型：${recentEventTypes}；content-type: ${
                        responseContentType || 'unknown'
                      }`
                } else {
                  taskFailureMessage =
                    '接口返回成功，但未识别到图片数据。请检查 SSE 事件中是否包含 response.output_item.done。'
                }
                continue
              }

              aggregatedImages.push(...nextImages)
              setImages([...aggregatedImages])
              const summaryLine = outputText || `第 ${taskIndex + 1} 条任务生成成功。`
              textualSummaries.push(
                isBatchRun
                  ? `[${taskIndex + 1}/${jobs.length}] ${summaryLine}`
                  : summaryLine,
              )
              setResponseText(textualSummaries.slice(-8).join('\n\n'))

              appendHistory({
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                provider: connection.provider,
                model: candidateModel,
                mode,
                prompt: taskPrompt,
                folder: historyFolderInput.trim(),
                tags: historyTags,
                endpoint: request.endpoint,
                status: 'success',
                statusCode: response.status,
                latencyMs: lastAttemptLatencyMs,
                images: getHistoryImages(nextImages),
                imageCount: nextImages.length,
                note: outputText || `模型返回图像成功（共 ${nextImages.length} 张）`,
                responseSnippet: raw.slice(0, 1600),
              })

              setUsageStore((previous) =>
                updateUsageStore(previous, connection.provider, nextImages.length, generation.quality),
              )

              if (candidateModel.toLowerCase() !== connection.model.trim().toLowerCase()) {
                setConnection((previous) => ({
                  ...previous,
                  model: candidateModel,
                }))
              }

              setQueueTasks((previous) =>
                previous.map((item) =>
                  item.id === job.id
                    ? {
                        ...item,
                        status: 'success',
                        finishedAt: performance.now(),
                        latencyMs: lastAttemptLatencyMs,
                        message: summaryLine,
                      }
                    : item,
                ),
              )

              taskSucceeded = true
              break
            } catch (error) {
              const reason = error instanceof Error ? error.message : '未知异常'
              taskFailureMessage = reason
              if (isLikelyFetchNetworkError(reason) || INPUT_STREAM_ERROR_PATTERN.test(reason)) {
                continue
              }
            }
          }
          if (taskSucceeded) {
            break
          }
        }

        if (!taskSucceeded) {
          setQueueTasks((previous) =>
            previous.map((item) =>
              item.id === job.id
                ? {
                    ...item,
                    status: 'error',
                    finishedAt: performance.now(),
                    message: taskFailureMessage || '执行失败',
                    endpoint: taskFailureEndpoint,
                  }
                : item,
            ),
          )
          throw new Error(taskFailureMessage || `批量第 ${taskIndex + 1} 条生成失败`)
        }

        if (runtimeConfig.requestIntervalMs > 0 && taskIndex < jobs.length - 1) {
          const effectiveInterval = Math.max(
            0,
            Math.floor(runtimeConfig.requestIntervalMs / Math.max(1, runtimeConfig.maxConcurrency)),
          )
          await sleep(effectiveInterval)
        }
      }

      const totalLatencyMs = Math.round(performance.now() - batchStartedAt)
      setRunState({
        phase: 'success',
        message: isBatchRun
          ? `批量完成 ${jobs.length}/${jobs.length} · 累计 ${aggregatedImages.length} 张图`
          : `生成完成，获得 ${aggregatedImages.length} 张图`,
        endpoint: attemptedEndpoint,
        statusCode: lastStatusCode,
        latencyMs: totalLatencyMs,
      })

      messageApi.success(
        isBatchRun
          ? `批量生图完成（${jobs.length} 条任务）`
          : '生图完成',
      )
    } catch (error) {
      const failureMessage =
        error instanceof Error ? error.message : '生成失败，请检查配置后重试'
      const isAbortError = error instanceof DOMException && error.name === 'AbortError'
      const isNetworkError = !isAbortError && isLikelyFetchNetworkError(failureMessage)
      const readableMessage = isAbortError
        ? '任务已取消'
        : isNetworkError
          ? `网络请求失败：${attemptedEndpoint || '未知 endpoint'}。请优先使用 /api-asxs/v1，同域代理可绕过跨域限制。原始错误：${failureMessage}`
          : failureMessage

      setRunState({
        phase: 'error',
        message: readableMessage,
        endpoint: attemptedEndpoint,
        statusCode: lastStatusCode,
        latencyMs: lastAttemptLatencyMs,
      })
      setResponseText(
        textualSummaries.length > 0
          ? `${textualSummaries.slice(-4).join('\n\n')}\n\n${readableMessage}`
          : readableMessage,
      )
      setQueueTasks((previous) =>
        previous.map((item) =>
          item.status === 'pending' || item.status === 'running'
            ? {
                ...item,
                status: 'error',
                message: readableMessage,
                finishedAt: performance.now(),
              }
            : item,
        ),
      )

      appendHistory({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        provider: connection.provider,
        model: attemptedModel,
        mode,
        prompt: attemptedPrompt,
        folder: historyFolderInput.trim(),
        tags: historyTags,
        endpoint: attemptedEndpoint,
        status: 'error',
        images: [],
        imageCount: 0,
        note: readableMessage,
        responseSnippet: readableMessage.slice(0, 1600),
      })

      messageApi.error(readableMessage)
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  hotkeyGenerateRef.current = handleGenerate
  hotkeyCancelRef.current = handleCancel

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase() ?? ''
      const editable = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void hotkeyGenerateRef.current()
        return
      }
      if (event.key === 'Escape' && isGenerating) {
        event.preventDefault()
        hotkeyCancelRef.current()
        return
      }
      if (editable) {
        return
      }
      if (event.altKey && event.key === '1') {
        setMode('text-to-image')
      }
      if (event.altKey && event.key === '2') {
        setMode('image-to-image')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isGenerating])

  const handleTestConnection = async () => {
    if (!connection.baseUrl.trim()) {
      messageApi.error('请先填写 Base URL')
      return
    }
    if (!connection.apiKey.trim()) {
      messageApi.error('请先填写 API Key')
      return
    }

    setIsTesting(true)
    setRunState({
      phase: 'testing',
      message: '连接测试中...',
      endpoint: '',
    })

    const rawBaseUrl = connection.baseUrl.trim()
    const baseUrl = resolveRuntimeBaseUrl(rawBaseUrl)
    const testPath = connection.modelsPath.replace('{model}', connection.model).trim()
    const primaryEndpoint =
      isResponsesEndpoint(baseUrl) && !isResponsesEndpoint(testPath)
        ? baseUrl
        : buildUrl(baseUrl, testPath)
    const fallbackEndpoint = isResponsesEndpoint(primaryEndpoint)
      ? ''
      : buildUrl(baseUrl, '/responses')
    const probeCandidates = [primaryEndpoint, fallbackEndpoint].filter(
      (candidate, index, all) => candidate && all.indexOf(candidate) === index,
    )
    const headers: Record<string, string> = parseExtraHeaders(connection.extraHeaders)

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 12000)
    const startedAt = performance.now()

    try {
      let matchedEndpoint = ''
      let matchedResponse: Response | null = null
      let matchedPreview = ''
      let matchedRaw = ''
      const probeErrors: string[] = []
      const probeStatusNotes: string[] = []

      for (const candidate of probeCandidates) {
        let endpoint = candidate
        if (connection.authMode === 'query') {
          endpoint = withQueryParam(endpoint, 'key', connection.apiKey.trim())
        }

        const requestInit: RequestInit = isResponsesEndpoint(endpoint)
          ? {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
                ...(connection.authMode === 'bearer'
                  ? { Authorization: `Bearer ${connection.apiKey.trim()}` }
                  : {}),
              },
              body: JSON.stringify({
                model: connection.model.trim() || 'gpt-5.4',
                stream: true,
                input: 'ping',
                tool_choice: {
                  type: 'image_generation',
                },
                tools: [
                  {
                    type: 'image_generation',
                    model: OPENAI_IMAGE_TOOL_MODEL,
                  },
                ],
              }),
            }
          : {
              method: 'GET',
              headers:
                connection.authMode === 'bearer'
                  ? {
                      ...headers,
                      Authorization: `Bearer ${connection.apiKey.trim()}`,
                    }
                  : headers,
            }

        try {
          const response = await fetch(endpoint, {
            ...requestInit,
            signal: controller.signal,
          })

          const responseRaw = await response.text()
          const preview = responseRaw.slice(0, 240)
          probeStatusNotes.push(`${endpoint} -> HTTP ${response.status}`)

          // Prefer a non-404 candidate when multiple probe candidates are available.
          if (response.status === 404 && probeCandidates.length > 1) {
            continue
          }

          matchedEndpoint = endpoint
          matchedResponse = response
          matchedPreview = preview
          matchedRaw = responseRaw
          break
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'network error'
          probeErrors.push(`${endpoint} -> ${reason}`)
        }
      }

      if (!matchedResponse) {
        if (probeStatusNotes.length > 0) {
          throw new Error(probeStatusNotes.join('\n'))
        }
        throw new Error(
          probeErrors.length > 0 ? probeErrors.join('\n') : '当前配置下未探测到可达接口',
        )
      }

      const latencyMs = Math.round(performance.now() - startedAt)
      const reachable = true
      const info = matchedResponse.ok
        ? `连接成功（${matchedResponse.status}）`
        : matchedResponse.status >= 500
          ? `接口可达（HTTP ${matchedResponse.status}，服务端返回异常）`
          : `接口可达（HTTP ${matchedResponse.status}，鉴权或参数待修正）`
      setRunState({
        phase: reachable ? 'success' : 'error',
        message: `${info} · ${latencyMs}ms`,
        endpoint: matchedEndpoint,
        statusCode: matchedResponse.status,
        latencyMs,
      })
      let detailText = matchedPreview || info

      if (matchedEndpoint.includes('/v1/models') && matchedRaw) {
        try {
          const parsed = safeJsonParse(matchedRaw)
          if (isRecord(parsed) && Array.isArray(parsed.data)) {
            const models = parsed.data
              .map((item) => (isRecord(item) && typeof item.id === 'string' ? item.id : ''))
              .filter(Boolean)
            if (models.length > 0 && !models.includes(connection.model.trim())) {
              detailText = `${detailText}\n\n提示：当前线路模型列表未检测到 "${connection.model}"，实际生图时可能返回 503。`
            }
          }
        } catch {
          // ignore parsing errors for diagnostics
        }
      }
      setResponseText(detailText)

      if (baseUrl !== rawBaseUrl) {
        setConnection((previous) => ({
          ...previous,
          baseUrl,
        }))
      }

      if (
        connection.provider === 'openai' &&
        (matchedEndpoint.includes('/v1/models') || isResponsesEndpoint(matchedEndpoint)) &&
        (connection.baseUrl !== baseUrl ||
          connection.modelsPath !== '/models' ||
          connection.openaiTextPath !== '/responses' ||
          connection.openaiEditPath !== '/responses')
      ) {
        setConnection((previous) => ({
          ...previous,
          baseUrl,
          modelsPath: '/models',
          openaiTextPath: '/responses',
          openaiEditPath: '/responses',
        }))
      }

      if (matchedResponse.ok) {
        messageApi.success(info)
      } else if (reachable) {
        messageApi.warning(info)
      } else {
        messageApi.error(info)
      }
    } catch (error) {
      const isAbortError = error instanceof DOMException && error.name === 'AbortError'
      const detail = error instanceof Error ? error.message : '未知错误'
      const text = isAbortError
        ? '连接测试超时'
        : '连接测试失败（已尝试代理与直连）'
      setRunState({
        phase: 'error',
        message: text,
        endpoint: primaryEndpoint,
      })
      setResponseText(`${text}\n${detail}`)
      messageApi.error(text)
    } finally {
      window.clearTimeout(timer)
      setIsTesting(false)
    }
  }

  const handleRestoreHistory = (record: HistoryRecord) => {
    setMode(record.mode)
    setGeneration((previous) => ({
      ...previous,
      prompt: record.prompt,
    }))
    setHistoryFolderInput(record.folder ?? '')
    setHistoryTagsInput((record.tags ?? []).join(','))
    setImages(record.images)
    setResponseText(record.note)
    setRawResponse(record.responseSnippet)
    setRunState({
      phase: record.status === 'success' ? 'success' : 'error',
      message: record.note,
      endpoint: record.endpoint,
      statusCode: record.statusCode,
      latencyMs: record.latencyMs,
    })
    messageApi.success('已恢复该条历史记录')
  }

  const renderBatchControl = (context: 'text' | 'image') => (
    <div className="batch-control">
      <div className="batch-head">
        <Text className="field-label">
          批量胜场{context === 'image' ? '（图生图）' : ''}
        </Text>
        <Space size={6}>
          <Tag color={batchQueuePreview.length > 0 ? 'gold' : 'default'}>
            队列 {batchQueuePreview.length} 条
          </Tag>
          <Tag>并发 x{runtimeConfig.maxConcurrency}</Tag>
        </Space>
      </div>
      <Segmented
        block
        value={batchConfig.mode}
        options={[
          { label: '单次', value: 'single' },
          { label: '多提示词', value: 'prompt-list' },
          { label: '抽卡', value: 'reroll' },
        ]}
        onChange={(value) =>
          setBatchConfig((previous) => ({
            ...previous,
            mode:
              value === 'prompt-list' || value === 'reroll'
                ? value
                : 'single',
          }))
        }
      />

      {batchConfig.mode === 'prompt-list' ? (
        <div className="batch-panel">
          <Text className="field-label">提示词清单（每行一条）</Text>
          <Input.TextArea
            className="prompt-list-input"
            value={batchConfig.promptList}
            onChange={(event) =>
              setBatchConfig((previous) => ({
                ...previous,
                promptList: event.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 16 }}
            placeholder={`示例：\n电影感人像，逆光，胶片质感\n高端产品海报，玻璃与金属材质\n国风庭院，晨雾，体积光`}
          />
          <Text type={batchQueuePreview.length > 0 ? 'secondary' : 'warning'}>
            可用任务数：{batchQueuePreview.length}（支持 `#` 或 `//` 注释行）
          </Text>
        </div>
      ) : null}

      {batchConfig.mode === 'reroll' ? (
        <div className="batch-reroll">
          <Text className="field-label">抽卡次数</Text>
          <InputNumber
            min={1}
            max={20}
            value={normalizedRerollCount}
            onChange={(value) =>
              setBatchConfig((previous) => ({
                ...previous,
                rerollCount: Math.max(
                  1,
                  Math.min(20, Math.floor(Number(value ?? 1))),
                ),
              }))
            }
            style={{ width: 180 }}
          />
          <Text type="secondary">
            {context === 'image'
              ? `同一参考图与提示词连续生成 ${normalizedRerollCount} 次，适合图生图抽卡挑图。`
              : `同一提示词连续生成 ${normalizedRerollCount} 次，适合抽卡挑图。`}
          </Text>
        </div>
      ) : null}
    </div>
  )

  const modeTabs: TabsProps['items'] = [
    {
      key: 'text-to-image',
      label: '文生图',
      children: (
        <div className="tab-content">
          <div className="preset-strip">
            {quickPromptTemplates.map((template) => (
              <Button
                key={template.id}
                size="small"
                className={generation.prompt.trim() === template.prompt ? 'preset-chip is-active' : 'preset-chip'}
                onClick={() => applyPromptTemplate(template)}
              >
                {template.label}
              </Button>
            ))}
            <Button
              size="small"
              icon={<StarOutlined />}
              onClick={() => setTemplateScope('favorites')}
            >
              只看收藏
            </Button>
          </div>

          <div className="template-center">
            <div className="template-center-head">
              <Text className="field-label">提示词模板中心</Text>
              <Space wrap size={6}>
                <Tag color="gold">收藏 {promptTemplateStore.favorites.length}</Tag>
                <Tag icon={<ClockCircleOutlined />}>最近 {promptTemplateStore.recent.length}</Tag>
                <Tag>模板库 {PROMPT_TEMPLATE_LIBRARY.length}</Tag>
              </Space>
            </div>

            <div className="template-center-toolbar">
              <Input
                allowClear
                prefix={<SearchOutlined />}
                value={templateQuery}
                onChange={(event) => setTemplateQuery(event.target.value)}
                placeholder="搜索模板名称、标签、场景、关键词..."
              />
              <Segmented
                value={templateScope}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '收藏', value: 'favorites' },
                  { label: '最近', value: 'recent' },
                ]}
                onChange={(value) =>
                  setTemplateScope(
                    value === 'favorites' || value === 'recent'
                      ? value
                      : 'all',
                  )
                }
              />
              <Select
                value={templateCategory}
                style={{ minWidth: 150 }}
                options={promptTemplateCategories.map((category) => ({
                  label: category === 'all' ? '全部分类' : category,
                  value: category,
                }))}
                onChange={(value) => setTemplateCategory(String(value))}
              />
            </div>

            {filteredPromptTemplates.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配到模板，请调整筛选条件"
              />
            ) : (
              <div className="template-grid">
                {filteredPromptTemplates.map((template) => {
                  const isFavorite = favoriteTemplateSet.has(template.id)
                  return (
                    <article key={template.id} className="template-item">
                      <div className="template-item-main">
                        <div className="template-item-head">
                          <Text strong>{template.label}</Text>
                          <Space size={6}>
                            <Tag color="geekblue">{template.category}</Tag>
                            {isFavorite ? <Tag color="gold">已收藏</Tag> : null}
                          </Space>
                        </div>
                        <Paragraph className="template-item-prompt" ellipsis={{ rows: 2 }}>
                          {template.prompt}
                        </Paragraph>
                        <Space wrap size={[6, 6]}>
                          {template.tags.map((tag) => (
                            <Tag key={`${template.id}-${tag}`}>{tag}</Tag>
                          ))}
                        </Space>
                      </div>
                      <div className="template-item-actions">
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => applyPromptTemplate(template)}
                        >
                          套用
                        </Button>
                        <Button
                          size="small"
                          icon={isFavorite ? <StarFilled /> : <StarOutlined />}
                          onClick={() => toggleFavoriteTemplate(template.id)}
                        >
                          {isFavorite ? '取消收藏' : '收藏'}
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {recentPromptTemplates.length > 0 ? (
              <div className="template-recent-strip">
                <Text type="secondary">最近使用：</Text>
                <Space wrap size={8}>
                  {recentPromptTemplates.map((template) => (
                    <Button
                      key={`recent-${template.id}`}
                      size="small"
                      onClick={() => applyPromptTemplate(template)}
                    >
                      {template.label}
                    </Button>
                  ))}
                </Space>
              </div>
            ) : null}
          </div>

          <Text className="field-label">提示词</Text>
          <Input.TextArea
            className="prompt-main-input"
            value={generation.prompt}
            onChange={(event) =>
              setGeneration((previous) => ({ ...previous, prompt: event.target.value }))
            }
            autoSize={{ minRows: 7, maxRows: 18 }}
            placeholder="描述画面主体、镜头、光影、材质和情绪..."
          />

          <Text className="field-label">负向提示词</Text>
          <Input.TextArea
            value={generation.negativePrompt}
            onChange={(event) =>
              setGeneration((previous) => ({ ...previous, negativePrompt: event.target.value }))
            }
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="不希望出现的元素，例如：模糊、文字乱码、畸形手部..."
          />
          {renderBatchControl('text')}
        </div>
      ),
    },
    {
      key: 'image-to-image',
      label: (
        <Space size={6}>
          <span>图生图</span>
          <Tag color="cyan">含抽卡</Tag>
        </Space>
      ),
      children: (
        <div className="tab-content">
          <Text className="field-label">重绘提示词</Text>
          <Input.TextArea
            className="prompt-main-input"
            value={generation.prompt}
            onChange={(event) =>
              setGeneration((previous) => ({ ...previous, prompt: event.target.value }))
            }
            autoSize={{ minRows: 6, maxRows: 16 }}
            placeholder="说明要保留哪些结构，要增强哪些细节..."
          />

          <Text className="field-label">负向提示词</Text>
          <Input
            value={generation.negativePrompt}
            onChange={(event) =>
              setGeneration((previous) => ({ ...previous, negativePrompt: event.target.value }))
            }
            placeholder="图生图负向限制"
          />
          <div className="i2i-reroll-shortcuts">
            <Text type="secondary">图生图支持抽卡：一键切换模式</Text>
            <Space wrap size={8}>
              <Button
                size="small"
                type={batchConfig.mode === 'single' ? 'primary' : 'default'}
                onClick={() =>
                  setBatchConfig((previous) => ({
                    ...previous,
                    mode: 'single',
                  }))
                }
              >
                单次
              </Button>
              <Button
                size="small"
                type={batchConfig.mode === 'reroll' ? 'primary' : 'default'}
                onClick={() =>
                  setBatchConfig((previous) => ({
                    ...previous,
                    mode: 'reroll',
                  }))
                }
              >
                抽卡
              </Button>
              <Button
                size="small"
                type={batchConfig.mode === 'prompt-list' ? 'primary' : 'default'}
                onClick={() =>
                  setBatchConfig((previous) => ({
                    ...previous,
                    mode: 'prompt-list',
                  }))
                }
              >
                多提示词
              </Button>
            </Space>
          </div>
          {renderBatchControl('image')}

          <div className="upload-row">
            <label className="upload-button">
              <UploadOutlined />
              上传参考图
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </label>
            {source.file ? (
              <Text type="secondary">{source.file.name}</Text>
            ) : (
              <Text type="secondary">尚未上传文件</Text>
            )}
          </div>
          {uploadAnalysis ? (
            <Text type="secondary">
              预处理输入：{uploadAnalysis.mimeType} · {uploadAnalysis.sizeKb}KB
              {typeof uploadAnalysis.width === 'number' && typeof uploadAnalysis.height === 'number'
                ? ` · ${uploadAnalysis.width}x${uploadAnalysis.height}`
                : ''}
              （超大图会自动压缩与规整）
            </Text>
          ) : null}

          {source.previewUrl ? (
            <div className="source-preview">
              <img src={source.previewUrl} alt="上传的参考图预览" />
            </div>
          ) : null}

          <Text className="field-label">或填写参考图 URL</Text>
          <Input
            value={source.imageUrl}
            onChange={(event) =>
              setSource((previous) => ({ ...previous, imageUrl: event.target.value }))
            }
            placeholder="https://..."
          />

          <Text className="field-label">
            重绘强度 <Tag>{generation.strength.toFixed(2)}</Tag>
          </Text>
          <Slider
            min={0.1}
            max={1}
            step={0.05}
            value={generation.strength}
            onChange={(value) =>
              setGeneration((previous) => ({ ...previous, strength: Number(value) }))
            }
          />
        </div>
      ),
    },
  ]

  return (
    <div className="studio-shell">
      {contextHolder}
      <div className="studio-ambient" aria-hidden>
        <span />
        <span />
        <span />
      </div>

      <header className="hero-card">
        <div className="hero-main">
          <Tag color="gold">Dual Engine Studio</Tag>
          <Title level={1}>Aurora Image Forge</Title>
          <Paragraph>
            面向生产场景的生图前端，OpenAI 侧采用 <Text code>gpt-5.4</Text> 驱动
            <Text code>image_generation(model: gpt-image-2)</Text>，并集成 Gemini
            <Text code>nanobanana2</Text>，支持文生图、图生图、参数调优、历史追溯与请求调试。
          </Paragraph>
          <Space wrap>
            <Tag icon={<ThunderboltOutlined />}>艺术化 UI</Tag>
            <Tag icon={<ApiOutlined />}>可编辑 URL / API</Tag>
            <Tag icon={<PictureOutlined />}>文生图 + 图生图</Tag>
          </Space>
          <div className="iteration-roadmap">
            {UI_UPGRADE_PLAN.map((item, index) => (
              <article key={item.title} className="roadmap-item">
                <span>迭代 0{index + 1}</span>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="hero-metrics">
          <div className="metric-item">
            <span>当前引擎</span>
            <strong>{connection.provider === 'openai' ? 'ChatGPT' : 'Gemini'}</strong>
          </div>
          <div className="metric-item">
            <span>当前模型</span>
            <strong>{connection.model || '-'}</strong>
          </div>
          <div className="metric-item">
            <span>最近状态</span>
            <Badge
              status={
                runState.phase === 'success'
                  ? 'success'
                  : runState.phase === 'error'
                    ? 'error'
                    : 'processing'
              }
              text={runState.message}
            />
          </div>
        </div>
      </header>

      <div
        className={layoutCompact ? 'layout-grid layout-grid-compact' : 'layout-grid'}
        style={
          layoutCompact
            ? undefined
            : {
                gridTemplateColumns: `minmax(320px, ${leftPanePercent / 100}fr) minmax(560px, ${(100 - leftPanePercent) / 100}fr)`,
              }
        }
      >
        <div className="left-column">
          <Card
            className="studio-card compact-card"
            title={
              <Space>
                <ApiOutlined />
                接口设置
              </Space>
            }
            extra={
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setConnection(DEFAULT_CONNECTION)
                  setGeneration(DEFAULT_GENERATION)
                  setBatchConfig(DEFAULT_BATCH)
                  setSource({ file: null, previewUrl: '', imageUrl: '' })
                  setMaskEditor(DEFAULT_MASK_EDITOR)
                  setUploadAnalysis(null)
                  setImages([])
                  setQueueTasks([])
                  setRunState(INITIAL_RUN_STATE)
                  setRequestPreview('')
                  setResponseText('')
                  setRawResponse('')
                }}
              >
                恢复默认
              </Button>
            }
          >
            <div className="field-grid">
              <div className="field-block">
                <Text className="field-label">服务商</Text>
                <Segmented
                  block
                  value={connection.provider}
                  options={[
                    { label: 'ChatGPT', value: 'openai' },
                    { label: 'Gemini', value: 'gemini' },
                  ]}
                  onChange={(value) => handleProviderChange(String(value))}
                />
              </div>

              <div className="field-block">
                <Text className="field-label">鉴权方式</Text>
                <Segmented
                  block
                  value={connection.authMode}
                  options={[
                    { label: 'Bearer', value: 'bearer' },
                    { label: 'Query Key', value: 'query' },
                  ]}
                  onChange={(value) =>
                    setConnection((previous) => ({
                      ...previous,
                      authMode: value === 'query' ? 'query' : 'bearer',
                    }))
                  }
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">Base URL</Text>
                <Input
                  value={connection.baseUrl}
                  onChange={(event) =>
                    setConnection((previous) => ({
                      ...previous,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="/api-asxs/v1 (推荐，同域代理)"
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">API Key</Text>
                <Input.Password
                  value={connection.apiKey}
                  onChange={(event) =>
                    setConnection((previous) => ({
                      ...previous,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder="输入 API Key"
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">模型</Text>
                <Select
                  value={connection.model}
                  style={{ width: '100%' }}
                  options={providerModelOptions.map((item) => ({ label: item, value: item }))}
                  onChange={(value) =>
                    setConnection((previous) => ({
                      ...previous,
                      model: String(value),
                    }))
                  }
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <div className="model-input-box">
                        <Input
                          placeholder="自定义模型名（回车保存）"
                          onPressEnter={(event) => {
                            const customModel = event.currentTarget.value.trim()
                            if (!customModel) {
                              return
                            }
                            setConnection((previous) => ({
                              ...previous,
                              model: customModel,
                            }))
                            event.currentTarget.value = ''
                          }}
                        />
                      </div>
                    </>
                  )}
                />
              </div>

              {connection.provider === 'openai' ? (
                <div className="field-block full-width">
                  <Text className="field-label">生图工具模型</Text>
                  <Input value={OPENAI_IMAGE_TOOL_MODEL} disabled />
                </div>
              ) : null}

              <div className="field-block full-width advanced-settings">
                <Collapse
                  size="small"
                  ghost
                  items={[
                    {
                      key: 'advanced-routes',
                      label: '高级路径与请求头',
                      children: (
                        <div className="field-grid advanced-grid">
                          <div className="field-block">
                            <Text className="field-label">模型探测路径</Text>
                            <Input
                              value={connection.modelsPath}
                              onChange={(event) =>
                                setConnection((previous) => ({
                                  ...previous,
                                  modelsPath: event.target.value,
                                }))
                              }
                              placeholder="/models"
                            />
                          </div>

                          <div className="field-block">
                            <Text className="field-label">OpenAI 文生图路径</Text>
                            <Input
                              value={connection.openaiTextPath}
                              onChange={(event) =>
                                setConnection((previous) => ({
                                  ...previous,
                                  openaiTextPath: event.target.value,
                                }))
                              }
                              placeholder="/responses"
                            />
                          </div>

                          <div className="field-block">
                            <Text className="field-label">OpenAI 图生图路径</Text>
                            <Input
                              value={connection.openaiEditPath}
                              onChange={(event) =>
                                setConnection((previous) => ({
                                  ...previous,
                                  openaiEditPath: event.target.value,
                                }))
                              }
                              placeholder="/responses"
                            />
                          </div>

                          <div className="field-block">
                            <Text className="field-label">Gemini 路径模板</Text>
                            <Input
                              value={connection.geminiPathTemplate}
                              onChange={(event) =>
                                setConnection((previous) => ({
                                  ...previous,
                                  geminiPathTemplate: event.target.value,
                                }))
                              }
                              placeholder="/v1beta/models/{model}:generateContent"
                            />
                          </div>

                          <div className="field-block full-width">
                            <Text className="field-label">额外请求头（JSON 或每行 key:value）</Text>
                            <Input.TextArea
                              value={connection.extraHeaders}
                              onChange={(event) =>
                                setConnection((previous) => ({
                                  ...previous,
                                  extraHeaders: event.target.value,
                                }))
                              }
                              autoSize={{ minRows: 2, maxRows: 6 }}
                              placeholder={`X-Project: image-lab\nX-Trace-Id: demo`}
                            />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </div>

            <Divider />

            <div className="field-grid">
              <div className="field-block">
                <Text className="field-label">布局压缩模式</Text>
                <Checkbox
                  checked={layoutCompact}
                  onChange={(event) => setLayoutCompact(event.target.checked)}
                >
                  紧凑布局（配置区折叠感）
                </Checkbox>
              </div>
              <div className="field-block">
                <Text className="field-label">左右分栏比例</Text>
                <Slider
                  min={30}
                  max={65}
                  value={leftPanePercent}
                  onChange={(value) => setLeftPanePercent(Number(value))}
                />
              </div>
              <div className="field-block">
                <Text className="field-label">历史归档文件夹</Text>
                <Input
                  value={historyFolderInput}
                  onChange={(event) => setHistoryFolderInput(event.target.value)}
                  placeholder="例如：海报项目 / 角色设定"
                />
              </div>
              <div className="field-block">
                <Text className="field-label">历史标签</Text>
                <Input
                  value={historyTagsInput}
                  onChange={(event) => setHistoryTagsInput(event.target.value)}
                  placeholder="商业, 赛博, 人像"
                />
              </div>
            </div>

            <Divider />

            <div className="workspace-hub">
              <Text className="field-label">协作空间（多账号/多项目档案）</Text>
              <Space wrap>
                <Input
                  value={workspaceNameInput}
                  onChange={(event) => setWorkspaceNameInput(event.target.value)}
                  placeholder="空间名"
                  style={{ width: 180 }}
                />
                <Button size="small" onClick={saveWorkspaceProfile}>
                  保存当前空间
                </Button>
                <Button size="small" onClick={exportReadonlyShareLink}>
                  复制只读分享链接
                </Button>
              </Space>
              <Space wrap size={8}>
                {workspaceProfiles.length === 0 ? (
                  <Text type="secondary">暂无空间快照</Text>
                ) : (
                  workspaceProfiles.map((profile) => (
                    <Space key={profile.id} size={4}>
                      <Button size="small" onClick={() => applyWorkspaceProfile(profile.id)}>
                        {profile.name}
                      </Button>
                      <Button size="small" danger onClick={() => deleteWorkspaceProfile(profile.id)}>
                        删
                      </Button>
                    </Space>
                  ))
                )}
              </Space>
            </div>

            <div className="actions-row">
              <Button
                icon={isTesting ? <ClockCircleOutlined /> : <ApiOutlined />}
                onClick={handleTestConnection}
                loading={isTesting}
              >
                测试连接
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleGenerate}
                loading={isGenerating}
                disabled={isGenerateDisabled}
              >
                {generateButtonLabel}
              </Button>
              <Button danger onClick={handleCancel} disabled={!isGenerating}>
                取消任务
              </Button>
            </div>
          </Card>

          <Card
            className="studio-card compact-card prompt-card"
            title={
              <Space>
                <SettingOutlined />
                生成设置
              </Space>
            }
          >
            <Tabs
              activeKey={mode}
              items={modeTabs}
              onChange={(nextKey) =>
                setMode(nextKey === 'image-to-image' ? 'image-to-image' : 'text-to-image')
              }
            />

            <div className="field-grid generation-grid">
              <div className="field-block">
                <Text className="field-label">分辨率</Text>
                <Select
                  value={generation.resolution}
                  style={{ width: '100%' }}
                  options={RESOLUTION_OPTIONS.map((item) => ({ label: item, value: item }))}
                  onChange={(value) =>
                    setGeneration((previous) => ({ ...previous, resolution: String(value) }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">长宽比</Text>
                <Select
                  value={generation.aspectRatio}
                  style={{ width: '100%' }}
                  options={ASPECT_RATIO_OPTIONS.map((item) => ({ label: item, value: item }))}
                  onChange={(value) =>
                    setGeneration((previous) => ({ ...previous, aspectRatio: String(value) }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">输出数量</Text>
                <InputNumber
                  min={1}
                  max={8}
                  value={generation.imageCount}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      imageCount: Number(value ?? 1),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>

              <div className="field-block">
                <Text className="field-label">风格</Text>
                <Select
                  value={generation.style}
                  style={{ width: '100%' }}
                  options={STYLE_OPTIONS.map((item) => ({ label: item, value: item }))}
                  onChange={(value) =>
                    setGeneration((previous) => ({ ...previous, style: String(value) }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">质量</Text>
                <Segmented
                  block
                  value={generation.quality}
                  options={[
                    { label: '标准', value: 'standard' },
                    { label: '高质', value: 'high' },
                  ]}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      quality: value === 'standard' ? 'standard' : 'high',
                    }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">输出格式</Text>
                <Segmented
                  block
                  value={generation.outputFormat}
                  options={[
                    { label: 'PNG', value: 'png' },
                    { label: 'JPEG', value: 'jpeg' },
                    { label: 'WEBP', value: 'webp' },
                  ]}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      outputFormat:
                        value === 'jpeg' || value === 'webp' ? value : 'png',
                    }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">背景</Text>
                <Segmented
                  block
                  value={generation.background}
                  options={[
                    { label: '自动', value: 'auto' },
                    { label: '不透明', value: 'opaque' },
                    { label: '透明', value: 'transparent' },
                  ]}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      background:
                        value === 'opaque' || value === 'transparent' ? value : 'auto',
                    }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">Seed（可选）</Text>
                <InputNumber
                  min={0}
                  step={1}
                  value={generation.seed ?? undefined}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      seed: typeof value === 'number' ? Math.floor(value) : null,
                    }))
                  }
                  style={{ width: '100%' }}
                  placeholder="不填则随机"
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">
                  温度 <Tag>{generation.temperature.toFixed(2)}</Tag>
                </Text>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={generation.temperature}
                  onChange={(value) =>
                    setGeneration((previous) => ({
                      ...previous,
                      temperature: Number(value),
                    }))
                  }
                />
              </div>
            </div>

            <Divider />

            <div className="preset-manager">
              <div className="preset-manager-head">
                <Text className="field-label">参数预设</Text>
                <Space>
                  <Button size="small" onClick={saveCurrentPreset}>
                    保存当前为预设
                  </Button>
                </Space>
              </div>
              <Space wrap size={8}>
                {presets.length === 0 ? (
                  <Text type="secondary">暂无预设，可先保存一套常用参数。</Text>
                ) : (
                  presets.map((preset) => (
                    <Space key={preset.id} size={4}>
                      <Button size="small" onClick={() => applyPreset(preset.id)}>
                        {preset.name}
                      </Button>
                      <Button size="small" danger onClick={() => removePreset(preset.id)}>
                        删
                      </Button>
                    </Space>
                  ))
                )}
              </Space>
            </div>

            <Divider />

            <div className="field-grid generation-grid">
              <div className="field-block">
                <Text className="field-label">并发通道（批量）</Text>
                <InputNumber
                  min={1}
                  max={5}
                  value={runtimeConfig.maxConcurrency}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      maxConcurrency: Math.max(1, Math.min(5, Math.floor(Number(value ?? 1)))),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div className="field-block">
                <Text className="field-label">请求间隔 ms</Text>
                <InputNumber
                  min={0}
                  max={5000}
                  step={100}
                  value={runtimeConfig.requestIntervalMs}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      requestIntervalMs: Math.max(0, Math.floor(Number(value ?? 0))),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div className="field-block">
                <Text className="field-label">今日配额（张）</Text>
                <InputNumber
                  min={1}
                  max={10000}
                  value={runtimeConfig.dailyImageQuota}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      dailyImageQuota: Math.max(1, Math.floor(Number(value ?? 1))),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div className="field-block">
                <Text className="field-label">今日预算（USD）</Text>
                <InputNumber
                  min={1}
                  max={2000}
                  step={0.5}
                  value={runtimeConfig.dailyBudgetUsd}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      dailyBudgetUsd: Math.max(1, Number(value ?? 1)),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">备用 Base URL（每行一个）</Text>
                <Input.TextArea
                  value={runtimeConfig.fallbackBaseUrls}
                  onChange={(event) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      fallbackBaseUrls: event.target.value,
                    }))
                  }
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  placeholder="https://api.asxs.top/v1"
                />
              </div>

              <div className="field-block">
                <Text className="field-label">质量守门</Text>
                <Checkbox
                  checked={runtimeConfig.qualityGuardEnabled}
                  onChange={(event) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      qualityGuardEnabled: event.target.checked,
                    }))
                  }
                >
                  启用提示词质量检查
                </Checkbox>
              </div>
              <div className="field-block">
                <Text className="field-label">最短提示词长度</Text>
                <InputNumber
                  min={1}
                  max={120}
                  value={runtimeConfig.minPromptLength}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      minPromptLength: Math.max(1, Math.floor(Number(value ?? 1))),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div className="field-block full-width">
                <Text className="field-label">敏感词（逗号分隔）</Text>
                <Input
                  value={runtimeConfig.blockedWords}
                  onChange={(event) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      blockedWords: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="field-block">
                <Text className="field-label">Seed 实验模式</Text>
                <Checkbox
                  checked={runtimeConfig.enableSeedExperiment}
                  onChange={(event) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      enableSeedExperiment: event.target.checked,
                    }))
                  }
                >
                  同提示词双 seed 对照
                </Checkbox>
              </div>
              <div className="field-block">
                <Text className="field-label">Seed 偏移量</Text>
                <InputNumber
                  min={1}
                  max={100000}
                  value={runtimeConfig.seedDelta}
                  onChange={(value) =>
                    setRuntimeConfig((previous) => ({
                      ...previous,
                      seedDelta: Math.max(1, Math.floor(Number(value ?? 1))),
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </div>

              <div className="field-block full-width">
                <Text className="field-label">批量导入（TXT / CSV / JSON）</Text>
                <Input.TextArea
                  value={importPromptText}
                  onChange={(event) => setImportPromptText(event.target.value)}
                  autoSize={{ minRows: 3, maxRows: 7 }}
                  placeholder='["提示词A","提示词B"] 或 每行一条'
                />
                <Space>
                  <label className="upload-button compact-upload">
                    导入文件
                    <input
                      type="file"
                      accept=".txt,.csv,.json"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (!file) {
                          return
                        }
                        void file
                          .text()
                          .then((text) => {
                            setImportPromptText(text)
                            messageApi.success(`已载入文件：${file.name}`)
                          })
                          .catch(() => messageApi.error('文件读取失败'))
                      }}
                    />
                  </label>
                  <Button size="small" onClick={importPromptLines}>
                    解析并写入批量队列
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setImportPromptText('')
                    }}
                  >
                    清空
                  </Button>
                </Space>
              </div>

              <div className="field-block full-width">
                <Text className="field-label">图生图局部重绘（蒙版策略）</Text>
                <Space wrap>
                  <Checkbox
                    checked={maskEditor.enabled}
                    onChange={(event) =>
                      setMaskEditor((previous) => ({
                        ...previous,
                        enabled: event.target.checked,
                      }))
                    }
                  >
                    启用局部重绘
                  </Checkbox>
                  <Segmented
                    value={maskEditor.protectMode}
                    options={[
                      { label: '保留中心', value: 'keep-center' },
                      { label: '重绘中心', value: 'edit-center' },
                    ]}
                    onChange={(value) =>
                      setMaskEditor((previous) => ({
                        ...previous,
                        protectMode: value === 'edit-center' ? 'edit-center' : 'keep-center',
                      }))
                    }
                  />
                </Space>
                <Input
                  value={maskEditor.maskNote}
                  onChange={(event) =>
                    setMaskEditor((previous) => ({
                      ...previous,
                      maskNote: event.target.value,
                    }))
                  }
                  placeholder="备注保护区域，例如：保留主体脸部，重绘背景。"
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="right-column">
          <Card
            className="studio-card status-card"
            title={
              <Space>
                <ThunderboltOutlined />
                运行状态
              </Space>
            }
          >
            <Alert
              type={
                runState.phase === 'success'
                  ? 'success'
                  : runState.phase === 'error'
                    ? 'error'
                    : 'info'
              }
              message={runState.message}
              showIcon
            />

            <div className="status-meta">
              <div>
                <Text type="secondary">预估请求地址</Text>
                <Paragraph copyable={{ text: endpointPreview }}>{endpointPreview}</Paragraph>
              </div>
              {runState.endpoint ? (
                <div>
                  <Text type="secondary">实际请求地址</Text>
                  <Paragraph copyable={{ text: runState.endpoint }}>
                    {runState.endpoint}
                  </Paragraph>
                </div>
              ) : null}
              <Space wrap>
                {runState.statusCode ? <Tag>HTTP {runState.statusCode}</Tag> : null}
                {typeof runState.latencyMs === 'number' ? (
                  <Tag icon={<ClockCircleOutlined />}>{runState.latencyMs} ms</Tag>
                ) : null}
                <Tag color={connection.provider === 'openai' ? 'blue' : 'green'}>
                  {connection.provider === 'openai' ? 'ChatGPT' : 'Gemini'} · {connection.model}
                </Tag>
              </Space>
            </div>
          </Card>

          <Card
            className="studio-card"
            title={
              <Space>
                <ClockCircleOutlined />
                任务队列
              </Space>
            }
          >
            {queueTasks.length === 0 ? (
              <Empty
                description="暂无队列任务，发起批量任务后将在这里看到进度。"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <div className="queue-list">
                {queueTasks.map((task, index) => (
                  <div key={task.id} className={`queue-item queue-${task.status}`}>
                    <div className="queue-item-head">
                      <Text strong>
                        #{index + 1} {task.status === 'success' ? '已完成' : task.status === 'error' ? '失败' : task.status === 'running' ? '执行中' : '排队中'}
                      </Text>
                      <Space size={6}>
                        {task.model ? <Tag>{task.model}</Tag> : null}
                        {typeof task.latencyMs === 'number' ? <Tag>{task.latencyMs} ms</Tag> : null}
                      </Space>
                    </div>
                    <Paragraph ellipsis={{ rows: 1 }} className="queue-prompt">
                      {task.prompt}
                    </Paragraph>
                    {task.message ? (
                      <Text type={task.status === 'error' ? 'danger' : 'secondary'}>{task.message}</Text>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            className="studio-card"
            title={
              <Space>
                <ApiOutlined />
                成本与健康
              </Space>
            }
          >
            <div className="cost-health-grid">
              <div className="metric-tile">
                <Text type="secondary">今日请求</Text>
                <Title level={4}>{todayUsage.requests}</Title>
              </div>
              <div className="metric-tile">
                <Text type="secondary">今日出图</Text>
                <Title level={4}>{todayUsage.images}</Title>
              </div>
              <div className="metric-tile">
                <Text type="secondary">今日估算成本</Text>
                <Title level={4}>${todayUsage.estimatedCostUsd.toFixed(2)}</Title>
              </div>
              <div className="metric-tile">
                <Text type="secondary">24h 成功率</Text>
                <Title level={4}>{historyHealth.successRate}%</Title>
              </div>
            </div>
            <div className="quota-bars">
              <Text type="secondary">
                图片配额 {todayUsage.images}/{runtimeConfig.dailyImageQuota}
              </Text>
              <Progress
                percent={Math.min(100, Math.round((todayUsage.images / runtimeConfig.dailyImageQuota) * 100))}
                showInfo={false}
                strokeColor="#39a08f"
              />
              <Text type="secondary">
                预算额度 ${todayUsage.estimatedCostUsd.toFixed(2)}/${runtimeConfig.dailyBudgetUsd.toFixed(2)}
              </Text>
              <Progress
                percent={Math.min(
                  100,
                  Math.round((todayUsage.estimatedCostUsd / runtimeConfig.dailyBudgetUsd) * 100),
                )}
                showInfo={false}
                strokeColor="#4f86d9"
              />
              <Text type="secondary">
                平均延迟 {historyHealth.avgLatencyMs}ms，24h 错误数 {historyHealth.errors24h}
              </Text>
            </div>
          </Card>

          <Card
            className="studio-card gallery-card"
            title={
              <Space>
                <PictureOutlined />
                当前画廊
              </Space>
            }
            extra={
              <Space>
                <Button
                  onClick={() => setShowOnlyKeptImages((previous) => !previous)}
                >
                  {showOnlyKeptImages ? '显示全部' : '仅看保留'}
                </Button>
                <Button onClick={() => void exportProjectZip()}>
                  导出项目 ZIP
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setImages([])
                    setPreviewImage(null)
                    setImageReviews({})
                    setQueueTasks([])
                    setSseEvents([])
                    setResponseText('')
                    setRawResponse('')
                    setRequestPreview('')
                    setRunState(INITIAL_RUN_STATE)
                  }}
                >
                  清空
                </Button>
              </Space>
            }
          >
            {isGenerating ? (
              <div className="gallery-loading">
                <Text>正在生成中，请稍候...</Text>
              </div>
            ) : null}

            {!isGenerating && images.length === 0 ? (
              <Empty
                description="暂无图片结果。请在左侧完成配置并点击「开始生成」。"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : null}
            {!isGenerating && images.length > 0 && visibleImages.length === 0 ? (
              <Empty
                description="当前过滤条件下没有图片（可切换为显示全部）。"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : null}

            {visibleImages.length > 0 ? (
              <div className="image-grid">
                {visibleImages.map((image) => (
                  <article
                    key={image.id}
                    className="image-card"
                    role="button"
                    tabIndex={0}
                    aria-label="查看大图"
                    onClick={() => setPreviewImage(image)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setPreviewImage(image)
                      }
                    }}
                  >
                    <img src={image.src} alt="模型生成结果图" />
                    <div className="image-actions">
                      <Tooltip title="下载图片">
                        <Button
                          type="text"
                          icon={<DownloadOutlined />}
                          onClick={(event) => {
                            event.stopPropagation()
                            void downloadImage(image).catch(() => {
                              messageApi.error('下载失败，请检查图片链接是否可访问')
                            })
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="设为图生图参考图">
                        <Button
                          type="text"
                          icon={<UploadOutlined />}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleUseAsReferenceImage(image)
                          }}
                        />
                      </Tooltip>
                    </div>
                    <div className="image-review-bar">
                      <div onClick={(event) => event.stopPropagation()}>
                        <Rate
                          allowClear
                          value={imageReviews[image.src]?.rating ?? 0}
                          onChange={(value) => updateImageReview(image, { rating: value })}
                        />
                      </div>
                      <Space size={6}>
                        <Button
                          size="small"
                          type={imageReviews[image.src]?.decision === 'keep' ? 'primary' : 'default'}
                          onClick={(event) => {
                            event.stopPropagation()
                            updateImageReview(image, {
                              decision:
                                imageReviews[image.src]?.decision === 'keep'
                                  ? 'unrated'
                                  : 'keep',
                            })
                          }}
                        >
                          保留
                        </Button>
                        <Button
                          size="small"
                          danger={imageReviews[image.src]?.decision === 'discard'}
                          onClick={(event) => {
                            event.stopPropagation()
                            updateImageReview(image, {
                              decision:
                                imageReviews[image.src]?.decision === 'discard'
                                  ? 'unrated'
                                  : 'discard',
                            })
                          }}
                        >
                          淘汰
                        </Button>
                      </Space>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </Card>

          <Modal
            open={Boolean(previewImage)}
            title="图片预览"
            width="min(96vw, 1120px)"
            centered
            onCancel={() => setPreviewImage(null)}
            footer={
              previewImage ? (
                <Space>
                  <Button
                    icon={<UploadOutlined />}
                    onClick={() => {
                      handleUseAsReferenceImage(previewImage)
                      setPreviewImage(null)
                    }}
                  >
                    设为图生图参考图
                  </Button>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      void downloadImage(previewImage).catch(() => {
                        messageApi.error('下载失败，请检查图片链接是否可访问')
                      })
                    }}
                  >
                    下载图片
                  </Button>
                </Space>
              ) : null
            }
          >
            {previewImage ? (
              <div className="image-preview-stage">
                <img src={previewImage.src} alt="预览大图" />
                <div className="image-preview-review">
                  <Text type="secondary">评分与备注（用于抽卡筛选）</Text>
                  <Rate
                    allowClear
                    value={imageReviews[previewImage.src]?.rating ?? 0}
                    onChange={(value) => updateImageReview(previewImage, { rating: value })}
                  />
                  <Input
                    value={imageReviews[previewImage.src]?.note ?? ''}
                    onChange={(event) =>
                      updateImageReview(previewImage, { note: event.target.value })
                    }
                    placeholder="记录这张图的优缺点，便于后续迭代。"
                  />
                </div>
              </div>
            ) : null}
          </Modal>

          <Card
            className="studio-card output-card"
            title={
              <Space>
                <SettingOutlined />
                请求与响应调试
              </Space>
            }
          >
            <Tabs
              items={[
                {
                  key: 'request',
                  label: '请求体',
                  children: (
                    <Input.TextArea
                      className="mono-area output-main-area"
                      value={requestPreview}
                      readOnly
                      autoSize={{ minRows: 10, maxRows: 24 }}
                      placeholder="生成前会显示请求体预览"
                    />
                  ),
                },
                {
                  key: 'text',
                  label: '结果文本',
                  children: (
                    <Input.TextArea
                      className="mono-area output-main-area"
                      value={responseText}
                      readOnly
                      autoSize={{ minRows: 10, maxRows: 24 }}
                      placeholder="模型文本响应会显示在这里"
                    />
                  ),
                },
                {
                  key: 'raw',
                  label: '原始响应',
                  children: (
                    <Input.TextArea
                      className="mono-area output-main-area"
                      value={rawResponse}
                      readOnly
                      autoSize={{ minRows: 10, maxRows: 24 }}
                      placeholder="原始 JSON / 文本响应"
                    />
                  ),
                },
                {
                  key: 'sse',
                  label: 'SSE 时间线',
                  children: sseEvents.length === 0 ? (
                    <Empty
                      description="暂无 SSE 事件。发起 Responses 流式任务后会自动记录。"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ) : (
                    <div className="sse-timeline">
                      {sseEvents.slice(-120).map((event, index) => (
                        <div key={`${event.at}-${index}`} className="sse-item">
                          <Text type="secondary">{new Date(event.at).toLocaleTimeString()}</Text>
                          <Tag>{event.type}</Tag>
                          <Paragraph ellipsis={{ rows: 2 }}>{event.preview}</Paragraph>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
            <Alert
              type="info"
              showIcon
              message="快捷键：Ctrl+Enter 生成，Esc 取消，Alt+1/2 切换文生图/图生图。"
            />
          </Card>

          <Card
            className="studio-card"
            title={
              <Space>
                <HistoryOutlined />
                历史记录
              </Space>
            }
            extra={
              <Space>
                <Button onClick={deleteSelectedHistory} danger>
                  删除选中
                </Button>
                <Button onClick={clearHistorySelection}>清空选择</Button>
                <Button onClick={() => setHistory([])} danger>
                  清空历史
                </Button>
              </Space>
            }
          >
            <div className="history-filters">
              <Input
                allowClear
                value={historyFilter.keyword}
                onChange={(event) =>
                  setHistoryFilter((previous) => ({
                    ...previous,
                    keyword: event.target.value,
                  }))
                }
                placeholder="关键词筛选（提示词/模型/备注/标签）"
              />
              <Space wrap>
                <Segmented
                  value={historyFilter.status}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '成功', value: 'success' },
                    { label: '失败', value: 'error' },
                  ]}
                  onChange={(value) =>
                    setHistoryFilter((previous) => ({
                      ...previous,
                      status: value === 'success' || value === 'error' ? value : 'all',
                    }))
                  }
                />
                <Segmented
                  value={historyFilter.mode}
                  options={[
                    { label: '全模式', value: 'all' },
                    { label: '文生图', value: 'text-to-image' },
                    { label: '图生图', value: 'image-to-image' },
                  ]}
                  onChange={(value) =>
                    setHistoryFilter((previous) => ({
                      ...previous,
                      mode:
                        value === 'text-to-image' || value === 'image-to-image'
                          ? value
                          : 'all',
                    }))
                  }
                />
                <Input
                  value={historyFilter.folder}
                  onChange={(event) =>
                    setHistoryFilter((previous) => ({
                      ...previous,
                      folder: event.target.value,
                    }))
                  }
                  placeholder="文件夹筛选"
                  style={{ width: 140 }}
                />
                <Input
                  type="date"
                  value={historyFilter.fromDate}
                  onChange={(event) =>
                    setHistoryFilter((previous) => ({
                      ...previous,
                      fromDate: event.target.value,
                    }))
                  }
                />
                <Input
                  type="date"
                  value={historyFilter.toDate}
                  onChange={(event) =>
                    setHistoryFilter((previous) => ({
                      ...previous,
                      toDate: event.target.value,
                    }))
                  }
                />
              </Space>
            </div>

            {filteredHistory.length === 0 ? (
              <Empty description="暂无历史记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="history-list">
                {filteredHistory.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="history-item"
                    onClick={() => handleRestoreHistory(item)}
                  >
                    <div className="history-header">
                      <Space size={6}>
                        <Checkbox
                          checked={historySelection.includes(item.id)}
                          onChange={(event) => {
                            event.stopPropagation()
                            setHistorySelection((previous) =>
                              event.target.checked
                                ? previous.includes(item.id)
                                  ? previous
                                  : [...previous, item.id]
                                : previous.filter((id) => id !== item.id),
                            )
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <Tag color={item.status === 'success' ? 'green' : 'red'}>
                          {item.status === 'success' ? '成功' : '失败'}
                        </Tag>
                        <Tag>{item.mode === 'text-to-image' ? '文生图' : '图生图'}</Tag>
                        <Tag>{item.provider === 'openai' ? 'ChatGPT' : 'Gemini'}</Tag>
                        {item.folder ? <Tag color="blue">{item.folder}</Tag> : null}
                        {(item.tags ?? []).map((tag) => (
                          <Tag key={`${item.id}-${tag}`}>{tag}</Tag>
                        ))}
                      </Space>
                      <Text type="secondary">
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                    </div>
                    <Paragraph className="history-prompt" ellipsis={{ rows: 2 }}>
                      {item.prompt}
                    </Paragraph>
                    <div className="history-footer">
                      <Text type="secondary">{item.model}</Text>
                      <Space>
                        {typeof item.latencyMs === 'number' ? (
                          <Text type="secondary">{item.latencyMs}ms</Text>
                        ) : null}
                        <Text type="secondary">
                          {item.imageCount > 0 ? `${item.imageCount} 张图` : '无图像'}
                        </Text>
                      </Space>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card
            className="studio-card prompt-helper-card"
            title={
              <Space>
                <ApiOutlined />
                Prompt 参考站
              </Space>
            }
            extra={
              <Button
                type="link"
                href={PROMPT_GUIDE_URL}
                target="_blank"
                rel="noreferrer"
              >
                新窗口打开
              </Button>
            }
          >
            <Alert
              type="info"
              showIcon
              message="目标站点启用了防嵌入策略（X-Frame-Options: DENY / frame-ancestors none），无法在页面内 iframe 展示。"
            />
            <div className="prompt-helper-actions">
              <Button type="primary" href={PROMPT_GUIDE_URL} target="_blank" rel="noreferrer">
                打开 Prompt 参考站
              </Button>
              <Button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(PROMPT_GUIDE_URL)
                    .then(() => messageApi.success('参考链接已复制'))
                    .catch(() => messageApi.error('复制失败，请手动复制链接'))
                }}
              >
                复制链接
              </Button>
            </div>
            <div className="prompt-helper-cheatsheet">
              <Text strong>内置速查（GPT-Image-2）</Text>
              <ul>
                <li>主体：先写“谁/什么”，再写动作与情绪。</li>
                <li>镜头：焦段、机位、构图（例如 85mm, close-up）。</li>
                <li>光照：主光方向、氛围光、对比度。</li>
                <li>材质：皮肤、金属、玻璃、布料等细节关键词。</li>
                <li>环境：时间、天气、场景元素、空间层次。</li>
                <li>风格：摄影、插画、电影感、海报感，尽量单一清晰。</li>
                <li>负向：在“负向提示词”里写要避免的缺陷与元素。</li>
                <li>迭代：固定 seed 后只改 1-2 个变量，便于抽卡对比。</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default App
