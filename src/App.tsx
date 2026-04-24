import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ApiOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  HistoryOutlined,
  PictureOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  InputNumber,
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
  endpoint: string
  status: 'success' | 'error'
  statusCode?: number
  latencyMs?: number
  images: StudioImage[]
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

const { Title, Paragraph, Text } = Typography

const CONNECTION_KEY = 'aurora-image-studio.connection.v1'
const GENERATION_KEY = 'aurora-image-studio.generation.v1'
const HISTORY_KEY = 'aurora-image-studio.history.v1'
const BATCH_KEY = 'aurora-image-studio.batch.v1'

const OPENAI_MODELS = ['gpt-5.4', 'gpt-5.2', 'gpt-5.4-mini']
const GEMINI_MODELS = ['nanobanana2']
const RESOLUTION_OPTIONS = ['1024x1024', '1536x1024', '1024x1536', '2048x2048']
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
const PROMPT_PRESETS = [
  {
    label: '电影级人像',
    prompt:
      '电影级写实人像，85mm镜头，浅景深，逆光轮廓光，真实皮肤细节，色彩层次丰富。',
  },
  {
    label: '国风场景',
    prompt:
      '中式古建筑庭院，丝绸服饰人物，晨雾光束，木结构细节清晰，电影构图，超清晰。',
  },
  {
    label: '产品海报',
    prompt:
      '高端产品商业海报，主体居中，玻璃与金属材质，工作室灯光，背景渐变，广告级质感。',
  },
  {
    label: '赛博夜景',
    prompt:
      '雨夜赛博城市街道，霓虹招牌反射，动态人群，体积光，广角镜头，视觉冲击力强。',
  },
]
const IMAGE_MODEL_FALLBACK_MODELS = ['nanobanana2']
const OPENAI_IMAGE_TOOL_MODEL = 'gpt-image-2'
const MODEL_UNAVAILABLE_PATTERN =
  /(全部渠道不可提供当前模型|当前模型不可用|model unavailable|not available|no channel|unsupported model)/i

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
          endpoint: typeof item.endpoint === 'string' ? item.endpoint : '',
          status: item.status === 'error' ? 'error' : 'success',
          statusCode: typeof item.statusCode === 'number' ? item.statusCode : undefined,
          latencyMs: typeof item.latencyMs === 'number' ? item.latencyMs : undefined,
          images,
          note: typeof item.note === 'string' ? item.note : '',
          responseSnippet:
            typeof item.responseSnippet === 'string' ? item.responseSnippet : '',
        } satisfies HistoryRecord
      })
  } catch {
    return []
  }
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

async function prepareRequest(
  mode: StudioMode,
  connection: ConnectionConfig,
  generation: GenerationConfig,
  source: ImageSourceState,
  modelOverride?: string,
  promptOverride?: string,
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
  const prompt = composePrompt(effectiveGeneration, mode, source)
  const runtimeBaseUrl = resolveRuntimeBaseUrl(connection.baseUrl)
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
          const base64 = await fileToBase64(source.file)
          const mime = source.file.type || 'image/png'
          content.push({
            type: 'input_image',
            image_url: `data:${mime};base64,${base64}`,
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
      n: effectiveGeneration.imageCount,
      size: effectiveGeneration.resolution,
      quality: effectiveGeneration.quality,
      output_format: effectiveGeneration.outputFormat,
      background: effectiveGeneration.background,
    }

    if (effectiveGeneration.seed !== null) {
      basePayload.seed = effectiveGeneration.seed
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
      formData.set('n', String(effectiveGeneration.imageCount))
      formData.set('size', effectiveGeneration.resolution)
      formData.set('quality', effectiveGeneration.quality)
      formData.set('output_format', effectiveGeneration.outputFormat)
      formData.set('background', effectiveGeneration.background)
      formData.set('strength', effectiveGeneration.strength.toFixed(2))
      formData.set('image', source.file)
      if (effectiveGeneration.seed !== null) {
        formData.set('seed', String(effectiveGeneration.seed))
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
      basePayload.strength = Number(effectiveGeneration.strength.toFixed(2))
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
      const base64 = await fileToBase64(source.file)
      parts.push({
        inlineData: {
          mimeType: source.file.type || 'image/png',
          data: base64,
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
    temperature: effectiveGeneration.temperature,
    candidateCount: effectiveGeneration.imageCount,
    responseModalities: ['TEXT', 'IMAGE'],
  }

  if (effectiveGeneration.aspectRatio !== 'auto') {
    generationConfig.aspectRatio = effectiveGeneration.aspectRatio
  }
  if (effectiveGeneration.seed !== null) {
    generationConfig.seed = effectiveGeneration.seed
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

  const abortRef = useRef<AbortController | null>(null)
  const previewUrlRef = useRef<string>('')
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection))
  }, [connection])

  useEffect(() => {
    localStorage.setItem(GENERATION_KEY, JSON.stringify(generation))
  }, [generation])

  useEffect(() => {
    localStorage.setItem(BATCH_KEY, JSON.stringify(batchConfig))
  }, [batchConfig])

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 40)))
  }, [history])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

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

    setIsGenerating(true)
    setRunState({
      phase: 'running',
      message: '任务已提交，正在等待模型生成图像',
      endpoint: '',
    })
    setResponseText('')
    setRawResponse('')

    const controller = new AbortController()
    abortRef.current = controller
    const batchStartedAt = performance.now()
    const isBatchRun = promptQueue.length > 1
    let attemptedModel = connection.model.trim()
    let attemptedEndpoint = endpointPreview
    let attemptedPrompt = generation.prompt.trim()
    let lastStatusCode: number | undefined
    let lastAttemptLatencyMs: number | undefined
    const aggregatedImages: StudioImage[] = []
    const textualSummaries: string[] = []

    try {
      for (let taskIndex = 0; taskIndex < promptQueue.length; taskIndex += 1) {
        const taskPrompt = promptQueue[taskIndex]
        attemptedPrompt = taskPrompt
        const modelCandidates = buildModelCandidates(connection.provider, connection.model)
        let taskSucceeded = false
        let taskFailureMessage = ''

        for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
          const candidateModel = modelCandidates[modelIndex]
          attemptedModel = candidateModel
          const attemptStartedAt = performance.now()

          const request = await prepareRequest(
            mode,
            connection,
            generation,
            source,
            candidateModel,
            taskPrompt,
          )
          attemptedEndpoint = request.endpoint
          setRequestPreview(request.requestPreview)
          setRunState({
            phase: 'running',
            message: isBatchRun
              ? `批量执行 ${taskIndex + 1}/${promptQueue.length} · 模型 ${candidateModel}`
              : modelCandidates.length > 1
                ? `正在尝试模型 ${candidateModel}（${modelIndex + 1}/${modelCandidates.length}）`
                : '任务已提交，正在等待模型生成图像',
            endpoint: request.endpoint,
          })

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
            const hasFallback = modelIndex < modelCandidates.length - 1
            if (MODEL_UNAVAILABLE_PATTERN.test(failure) && hasFallback) {
              const nextModel = modelCandidates[modelIndex + 1]
              setResponseText(
                `模型 ${candidateModel} 当前不可用，正在自动切换到 ${nextModel} 重试...`,
              )
              continue
            }
            taskFailureMessage = failure
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
            break
          }

          aggregatedImages.push(...nextImages)
          setImages([...aggregatedImages])
          const summaryLine = outputText || `第 ${taskIndex + 1} 条任务生成成功。`
          textualSummaries.push(
            isBatchRun
              ? `[${taskIndex + 1}/${promptQueue.length}] ${summaryLine}`
              : summaryLine,
          )
          setResponseText(textualSummaries.slice(-6).join('\n\n'))

          appendHistory({
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            provider: connection.provider,
            model: candidateModel,
            mode,
            prompt: taskPrompt,
            endpoint: request.endpoint,
            status: 'success',
            statusCode: response.status,
            latencyMs: lastAttemptLatencyMs,
            images: nextImages,
            note: outputText || '模型返回图像成功',
            responseSnippet: raw.slice(0, 1600),
          })

          if (candidateModel.toLowerCase() !== connection.model.trim().toLowerCase()) {
            setConnection((previous) => ({
              ...previous,
              model: candidateModel,
            }))
          }

          taskSucceeded = true
          break
        }

        if (!taskSucceeded) {
          throw new Error(taskFailureMessage || `批量第 ${taskIndex + 1} 条生成失败`)
        }
      }

      const totalLatencyMs = Math.round(performance.now() - batchStartedAt)
      setRunState({
        phase: 'success',
        message: isBatchRun
          ? `批量完成 ${promptQueue.length}/${promptQueue.length} · 累计 ${aggregatedImages.length} 张图`
          : `生成完成，获得 ${aggregatedImages.length} 张图`,
        endpoint: attemptedEndpoint,
        statusCode: lastStatusCode,
        latencyMs: totalLatencyMs,
      })

      messageApi.success(
        isBatchRun
          ? `批量生图完成（${promptQueue.length} 条任务）`
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

      appendHistory({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        provider: connection.provider,
        model: attemptedModel,
        mode,
        prompt: attemptedPrompt,
        endpoint: attemptedEndpoint,
        status: 'error',
        images: [],
        note: readableMessage,
        responseSnippet: readableMessage.slice(0, 1600),
      })

      messageApi.error(readableMessage)
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

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

  const modeTabs: TabsProps['items'] = [
    {
      key: 'text-to-image',
      label: '文生图',
      children: (
        <div className="tab-content">
          <div className="preset-strip">
            {PROMPT_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                size="small"
                className={generation.prompt.trim() === preset.prompt ? 'preset-chip is-active' : 'preset-chip'}
                onClick={() =>
                  setGeneration((previous) => ({
                    ...previous,
                    prompt: preset.prompt,
                    style: previous.style === 'auto' ? 'cinematic' : previous.style,
                  }))
                }
              >
                {preset.label}
              </Button>
            ))}
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

          <div className="batch-control">
            <div className="batch-head">
              <Text className="field-label">批量胜场</Text>
              <Tag color={batchQueuePreview.length > 0 ? 'gold' : 'default'}>
                队列 {batchQueuePreview.length} 条
              </Tag>
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
                  同一提示词连续生成 {normalizedRerollCount} 次，适合抽卡挑图。
                </Text>
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'image-to-image',
      label: '图生图',
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

      <div className="layout-grid">
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
                  setSource({ file: null, previewUrl: '', imageUrl: '' })
                  setImages([])
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
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setImages([])
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

            {images.length > 0 ? (
              <div className="image-grid">
                {images.map((image) => (
                  <article key={image.id} className="image-card">
                    <img src={image.src} alt="模型生成结果图" />
                    <div className="image-actions">
                      <Tooltip title="下载图片">
                        <Button
                          type="text"
                          icon={<DownloadOutlined />}
                          onClick={() => {
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
                          onClick={() => {
                            setMode('image-to-image')
                            setSource((previous) => ({
                              ...previous,
                              imageUrl: image.src,
                            }))
                            messageApi.success('已填入图生图参考图 URL')
                          }}
                        />
                      </Tooltip>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </Card>

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
              ]}
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
              <Button onClick={() => setHistory([])} danger>
                清空历史
              </Button>
            }
          >
            {history.length === 0 ? (
              <Empty description="暂无历史记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="history-item"
                    onClick={() => handleRestoreHistory(item)}
                  >
                    <div className="history-header">
                      <Space size={6}>
                        <Tag color={item.status === 'success' ? 'green' : 'red'}>
                          {item.status === 'success' ? '成功' : '失败'}
                        </Tag>
                        <Tag>{item.mode === 'text-to-image' ? '文生图' : '图生图'}</Tag>
                        <Tag>{item.provider === 'openai' ? 'ChatGPT' : 'Gemini'}</Tag>
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
                          {item.images.length > 0 ? `${item.images.length} 张图` : '无图像'}
                        </Text>
                      </Space>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default App
