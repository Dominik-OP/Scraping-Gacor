import { createFileRoute } from '@tanstack/react-router'
import { DashboardApp } from '../components/DashboardApp'
import { getBootstrap } from '../server/api'

export const Route = createFileRoute('/')({
  loader: () => getBootstrap(),
  component: DashboardPage,
})

function DashboardPage() {
  return <DashboardApp initial={Route.useLoaderData()} />
}
