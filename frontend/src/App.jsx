import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './components/Home'
import Chat from './components/Chat'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat/:chatId" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
