import { createHashRouter, Navigate } from "react-router-dom";
import { Layout } from "./components/common/Layout";
import { HomePage } from "./pages/HomePage";
import { StandingsPage } from "./pages/StandingsPage";
import { SchedulePage } from "./pages/SchedulePage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { StatsPage } from "./pages/StatsPage";
import { TeamDetailPage } from "./pages/TeamDetailPage";
import { EditHistoryPage } from "./pages/EditHistoryPage";
import { EditMatchesPage } from "./pages/EditMatchesPage";
import { PastTournamentsPage } from "./pages/PastTournamentsPage";
import { PastTournamentDetailPage } from "./pages/PastTournamentDetailPage";
import { ColumnsPage } from "./pages/ColumnsPage";
import { ColumnDetailPage } from "./pages/ColumnDetailPage";

export const router = createHashRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "standings", element: <StandingsPage /> },
      { path: "schedule", element: <SchedulePage /> },
      { path: "matches", element: <Navigate to="/schedule" replace /> },
      { path: "matches/:id", element: <MatchDetailPage /> },
      { path: "teams/:id", element: <TeamDetailPage /> },
      { path: "stats", element: <StatsPage /> },
      { path: "past", element: <PastTournamentsPage /> },
      { path: "past/:year", element: <PastTournamentDetailPage /> },
      { path: "columns", element: <ColumnsPage /> },
      { path: "columns/:id", element: <ColumnDetailPage /> },
      { path: "edit/history", element: <EditHistoryPage /> },
      { path: "edit/matches", element: <EditMatchesPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
