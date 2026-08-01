'use client'

import { useState, lazy, Suspense } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Smile, Loader2 } from 'lucide-react'

// Lazy-load emoji-mart — the dataset is ~500KB and shouldn't be in the main bundle.
// Only loads when the user first opens the emoji picker.
const Picker = lazy(() => import('@emoji-mart/react').then((mod) => ({ default: mod.default })))
const emojiDataPromise = import('@emoji-mart/data').then((mod) => mod.default)

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void
  className?: string
}

/**
 * EmojiPicker — WhatsApp/Slack-style emoji picker for desktop.
 *
 * Features:
 *   - Search by name or shortcode (e.g. "heart" or ":heart:")
 *   - Categories (smileys, gestures, animals, food, activities, travel, objects, symbols, flags)
 *   - Recently used (auto-tracked by emoji-mart)
 *   - Skin tone selector
 *   - Lazy-loaded (500KB dataset only loads when first opened)
 *
 * Mobile users don't see this — they have native emoji keyboards.
 */
export function EmojiPicker({ onEmojiSelect, className = '' }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [emojiData, setEmojiData] = useState<any>(null)

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    // Load emoji data on first open
    if (newOpen && !emojiData) {
      emojiDataPromise.then((data) => setEmojiData(data))
    }
  }

  const handleEmojiSelect = (emoji: any) => {
    // emoji-mart gives us { id, name, skins: [{ native }], ... }
    // We want the native emoji character (e.g. "😀")
    const native = emoji?.native || emoji?.skins?.[0]?.native || ''
    if (native) {
      onEmojiSelect(native)
    }
    // Keep the popover open so the user can pick multiple emoji in a row
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`hidden md:flex w-10 h-10 items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90 ${className}`}
          title="Emoji"
          aria-label="Open emoji picker"
        >
          <Smile className="w-[22px] h-[22px] transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 bg-transparent shadow-none"
        side="top"
        align="start"
        sideOffset={8}
      >
        <Suspense
          fallback={
            <div className="w-[352px] h-[440px] flex items-center justify-center glass-dark rounded-2xl border border-white/10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {emojiData ? (
            <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10">
              <Picker
                data={emojiData}
                onEmojiSelect={handleEmojiSelect}
                theme="dark"
                previewPosition="none"
                skinTonePosition="search"
                searchPosition="sticky"
                navPosition="bottom"
                perLine={8}
                maxFrequentRows={4}
                locale="en"
                categories={[
                  'frequent',
                  'people',
                  'nature',
                  'foods',
                  'activity',
                  'places',
                  'objects',
                  'symbols',
                  'flags',
                ]}
                categoryIcons={{
                  frequent: '⏱️',
                  people: '🙂',
                  nature: '🐶',
                  foods: '🍔',
                  activity: '⚽',
                  places: '✈️',
                  objects: '💡',
                  symbols: '❤️',
                  flags: '🏁',
                }}
              />
            </div>
          ) : (
            <div className="w-[352px] h-[440px] flex items-center justify-center glass-dark rounded-2xl border border-white/10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
