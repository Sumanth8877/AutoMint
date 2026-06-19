import { RouteTransition } from '@/components/route-transition';

export default function AuthenticatedTemplate({ children }: { children: React.ReactNode }) {
  return <RouteTransition>{children}</RouteTransition>;
}
