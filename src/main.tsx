import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useAppStore } from './store/useAppStore'

// 供浏览器端自动化测试与调试读取/驱动应用状态
if (typeof window !== 'undefined') {
  ;(window as unknown as { __appStore: typeof useAppStore }).__appStore = useAppStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
