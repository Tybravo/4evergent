import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAgentNames } from '../agentNames';
import { useApiResource } from '../hooks/useApiResource';
import type { ActivityRecord } from '../types';
import { AgentName, StatusBadge, Skeleton, EmptyState, IntentAmount, PaginationFooter } from '../components';

const PAGE_SIZE = 50;

interface ActivityResponse {
  activity: ActivityRecord[];
  hasMore: boolean;
  nextOffset: number;
}

export default function Activity() {
  const navigate = useNavigate();
  const agentNames = useAgentNames();

  const fetcher = useCallback(async (): Promise<ActivityResponse> => {
    const r = await api.listActivity(PAGE_SIZE, 0);
    return {
      activity: r.activity,
      hasMore: r.hasMore,
      nextOffset: r.activity.length,
    };
  }, []);

  const { data, error, loading, reload } = useApiResource<ActivityResponse>(fetcher, []);

  if (error) return <EmptyState title="Failed to load activity" message={error} error={true} actionLabel="Retry" onAction={reload} />;
  if (loading || data === null) return <Skeleton label="Loading activity..." />;
  
  const { activity, hasMore } = data;
  
  if (activity.length === 0) {
    return (
      <EmptyState
        title="No activity"
        message="Submit an intent to generate activity records."
      />
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1>Activity</h1>
        <p className="muted">Audit trail of all agent operations.</p>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Agent</th>
              <th>Intent</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((r) => (
              <tr
                key={r.id}
                className="table-row-link"
                onClick={() => navigate(`/agents/${r.agentId}/activity/${r.id}`)}
              >
                <td><code>{r.id.slice(0, 8)}</code></td>
                <td><AgentName agentId={r.agentId} agentNames={agentNames} /></td>
                <td>{r.intent.type}</td>
                <td><IntentAmount intent={r.intent} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationFooter hasMore={hasMore} loadingMore={false} onLoadMore={() => {}} itemCount={activity.length} />
      {/* Pagination not migrated - kept as future work */}
    </section>
  );
}
