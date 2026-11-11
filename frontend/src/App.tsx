import { Navigate, Route, Routes } from "react-router"

import { CallTypes } from "@/pages/admin/call-types"
import { Upcoming } from "@/pages/admin/upcoming"
import { CallTypeSlots } from "@/pages/guest/call-type-slots"
import { Home } from "@/pages/home"

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/call-types/:id" element={<CallTypeSlots />} />
      <Route path="/admin" element={<CallTypes />} />
      <Route path="/admin/upcoming" element={<Upcoming />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
