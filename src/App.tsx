import { BlockPalette } from './components/BlockPalette'
import { FlowEditor } from './components/FlowEditor'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden />
          <div>
            <h1 className="app__title">Control Graph</h1>
            <p className="app__subtitle">PLC execution graph editor</p>
          </div>
        </div>
      </header>
      <main className="app__main">
        <BlockPalette />
        <FlowEditor />
      </main>
    </div>
  )
}

export default App
