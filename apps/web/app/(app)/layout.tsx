import WorkspaceProvider from "../components/WorkspaceProvider";

export default function AppWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
