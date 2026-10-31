// Ikon SVG (lucide, ISC) — hanya ikon yang dipakai yang ikut dibundel.
import {
  Video, Mic, MicOff, VideoOff, MonitorUp, MonitorX, Hand, PhoneOff, LogOut, Users, UserPlus, User, MessageSquare, StickyNote,
  Settings, EllipsisVertical, Ellipsis, Plus, X, Check, Copy, Link, Calendar, CalendarPlus, Clock, ShieldCheck, Zap, Globe, Award,
  GraduationCap, Building2, Presentation, MousePointer2, Move, PenLine, Eraser, Square, Circle, Minus, ArrowUpRight, Type, Undo2,
  Redo2, Trash2, Upload, Download, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ZoomIn, ZoomOut, Maximize, Minimize, Expand,
  LayoutGrid, CircleDot, Signal, Volume2, Headphones, Lock, LockOpen, Crown, Smile, ChartColumn, Send, Search, Menu, LogIn, DoorOpen,
  Sparkles, Image, Sun, Eye, EyeOff, FileText, Info, TriangleAlert, Laptop, BookOpen, Mail, MapPin, Phone, UserCheck, UserX, Shield,
  RefreshCw, Pencil, Captions, CaptionsOff, AudioLines, ListChecks, MessageCircle, FileUp, Gauge, LayoutPanelTop, CircleCheck, Ban, UserCog, Speaker, Radio, Pin, Keyboard,
  Languages, Split, Smartphone, MoonStar, Palette, FileDown, Clapperboard,
} from 'lucide';

const SET = {
  video: Video, mic: Mic, 'mic-off': MicOff, 'video-off': VideoOff, 'monitor-up': MonitorUp, 'monitor-x': MonitorX, hand: Hand,
  'phone-off': PhoneOff, 'log-out': LogOut, users: Users, 'user-plus': UserPlus, user: User, 'message-square': MessageSquare,
  'sticky-note': StickyNote, settings: Settings, 'more-v': EllipsisVertical, more: Ellipsis, plus: Plus, x: X, check: Check, copy: Copy,
  link: Link, calendar: Calendar, 'calendar-plus': CalendarPlus, clock: Clock, 'shield-check': ShieldCheck, zap: Zap, globe: Globe,
  award: Award, 'graduation-cap': GraduationCap, building: Building2, presentation: Presentation, pointer: MousePointer2, move: Move,
  pen: PenLine, eraser: Eraser, square: Square, circle: Circle, minus: Minus, arrow: ArrowUpRight, type: Type, undo: Undo2, redo: Redo2,
  trash: Trash2, upload: Upload, download: Download, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  'chevron-up': ChevronUp, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, maximize: Maximize, minimize: Minimize, expand: Expand, grid: LayoutGrid,
  record: CircleDot, signal: Signal, volume: Volume2, headphones: Headphones, lock: Lock, unlock: LockOpen, crown: Crown, smile: Smile,
  poll: ChartColumn, send: Send, search: Search, menu: Menu, 'log-in': LogIn, door: DoorOpen, sparkles: Sparkles, image: Image, sun: Sun,
  eye: Eye, 'eye-off': EyeOff, file: FileText, info: Info, alert: TriangleAlert, laptop: Laptop, book: BookOpen, mail: Mail, pin: MapPin,
  phone: Phone, 'user-check': UserCheck, 'user-x': UserX, shield: Shield, refresh: RefreshCw, pencil: Pencil, 'list-checks': ListChecks,
  'message-circle': MessageCircle, 'file-up': FileUp, gauge: Gauge, layout: LayoutPanelTop, 'circle-check': CircleCheck, ban: Ban,
  'user-cog': UserCog, speaker: Speaker, radio: Radio, 'pin-icon': Pin, keyboard: Keyboard, captions: Captions, 'captions-off': CaptionsOff, 'audio-lines': AudioLines,
  languages: Languages, split: Split, smartphone: Smartphone, 'moon-star': MoonStar, palette: Palette, 'file-down': FileDown, clapper: Clapperboard,
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 20, cls = '') {
  const node = SET[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', ('ic ' + cls).trim());
  for (const [tag, attrs] of node || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** Ganti semua <i data-i="nama"> dengan SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-i]')) {
    const svg = icon(el.dataset.i, +(el.dataset.s || 20), el.className);
    el.replaceWith(svg);
  }
}
