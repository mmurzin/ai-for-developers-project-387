import { Link, NavLink, Outlet } from "react-router"

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "rounded-md px-3 py-2 text-sm",
    isActive
      ? "bg-muted font-medium"
      : "text-muted-foreground hover:bg-muted/60",
  ].join(" ")

// AdminLayout — оболочка Панели владельца: слева постоянное меню
// («Типы звонков», «Предстоящие», внизу «На главную»), справа —
// выбранная страница. На узких экранах блоки складываются стопкой:
// меню — горизонтальный ряд кнопок над контентом.
export function AdminLayout() {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <nav className="flex flex-wrap items-center gap-2 border-b p-4 md:w-60 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:border-r">
        <p className="mr-2 text-lg font-medium md:mr-0 md:pb-2 md:px-3">
          Панель владельца
        </p>
        <NavLink to="/admin" end className={navLinkClass}>
          Типы звонков
        </NavLink>
        <NavLink to="/admin/upcoming" className={navLinkClass}>
          Предстоящие
        </NavLink>
        <Link
          to="/"
          className="text-muted-foreground underline-offset-4 text-sm hover:underline md:mt-auto md:px-3 md:py-2"
        >
          На главную
        </Link>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
