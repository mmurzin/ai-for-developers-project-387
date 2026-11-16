import { Navigate, Route, Routes } from "react-router"

import { AdminLayout } from "@/pages/admin/layout"
import { CallTypes } from "@/pages/admin/call-types"
import { Upcoming } from "@/pages/admin/upcoming"
import { CallTypeSlots } from "@/pages/guest/call-type-slots"
import { Home } from "@/pages/home"

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/call-types/:id" element={<CallTypeSlots />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<CallTypes />} />
        <Route path="upcoming" element={<Upcoming />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
