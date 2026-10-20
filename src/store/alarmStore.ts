import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { alarmSound } from '../lib/alarmAudio'

export interface LowStockItem {
  id: string | number
  name: string
  variantName?: string
  stock: number
  alertThreshold: number
  barcode?: string
  category?: string
}

interface AlarmState {
  lowStockItems: LowStockItem[]
  isAlarmActive: boolean
  soundEnabled: boolean
  silencedItemIds: Set<string | number>
  setLowStockItems: (items: LowStockItem[]) => void
  setSoundEnabled: (enabled: boolean) => void
  silenceAlarm: () => void
  resetSilencedState: () => void
}

export const useAlarmStore = create<AlarmState>()(
  persist(
    (set, get) => ({
      lowStockItems: [],
      isAlarmActive: false,
      soundEnabled: true,
      silencedItemIds: new Set<string | number>(),

      setLowStockItems: (items) => {
        // Forget silenced ids that are no longer low, so an item that recovers and drops again alarms as new
        const currentIds = new Set(items.map((item) => String(item.id)))
        const silencedItemIds = new Set(Array.from(get().silencedItemIds).filter((id) => currentIds.has(String(id))))
        set({ silencedItemIds })
    
        // Alarm triggers only if there is at least one low-stock item that has not been acknowledged
        const hasUnsilencedLowStock = items.some(
          (item) => !silencedItemIds.has(String(item.id)) && !silencedItemIds.has(item.id)
        )

        if (items.length > 0 && hasUnsilencedLowStock) {
          const wasAlarmActive = get().isAlarmActive
      
          if (get().soundEnabled) alarmSound.startAlert()
          else alarmSound.stopAlert()
          set({ lowStockItems: items, isAlarmActive: true })
      
          if (!wasAlarmActive) {
            console.log('[Low Stock Alert] New low stock items detected:', items.length)
          }
        } else {
          alarmSound.stopAlert()
          set({ lowStockItems: items, isAlarmActive: false })
          if (items.length === 0) {
            set({ silencedItemIds: new Set() })
          }
        }
      },

      setSoundEnabled: (enabled) => {
        set({ soundEnabled: enabled })
        if (!enabled) {
          alarmSound.stopAlert()
          return
        }
        const { isAlarmActive, silencedItemIds, lowStockItems } = get()
        const hasUnsilencedLowStock = lowStockItems.some(
          item => !silencedItemIds.has(String(item.id)) && !silencedItemIds.has(item.id)
        )
        if (isAlarmActive && hasUnsilencedLowStock) alarmSound.startAlert()
      },

      silenceAlarm: () => {
        const currentItemIds = get().lowStockItems.map((i) => String(i.id))
        alarmSound.stopAlert()
        set({
          isAlarmActive: false,
          silencedItemIds: new Set(currentItemIds),
        })
      },

      resetSilencedState: () => {
        set({ silencedItemIds: new Set() })
      },
    }),
    {
      name: 'the-one-low-stock-alert-settings',
      partialize: state => ({ soundEnabled: state.soundEnabled }) as AlarmState,
    },
  ),
)
