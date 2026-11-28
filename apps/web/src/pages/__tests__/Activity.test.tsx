import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Activity from '../Activity';

const mockListActivity = vi.fn();
const mockListAllAgents = vi.fn();

vi.mock('../../api', () => ({
  api: {
    listActivity: (...args: any[]) => mockListActivity(...args),
    listAgents: vi.fn().mockResolvedValue({ agents: [] }),
    listAllAgents: (...args: any[]) => mockListAllAgents(...args),
    agentActivity: vi.fn().mockResolvedValue({ activity: [] }),
  },
}));

describe('Activity page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls listActivity on mount', async () => {
    mockListActivity.mockResolvedValue({ activity: [] });
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => {
      expect(mockListActivity).toHaveBeenCalled();
    });
  });

  it('renders empty state when no activity', async () => {
    mockListActivity.mockResolvedValue({ activity: [] });
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No activity')).toBeInTheDocument();
    });
  });

  it('renders error state', async () => {
    mockListActivity.mockRejectedValue(new Error('API error'));
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
    });
  });

  it('retry button re-fetches and renders data after a transient failure', async () => {
    mockListActivity
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        activity: [
          {
            id: 'act-1',
            agentId: 'agent-a',
            ownerId: 'owner-a',
            intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
            policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
            authorizationStatus: null,
            simulationResult: null,
            txHash: null,
            status: 'submitted',
            error: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });

    render(<MemoryRouter><Activity /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockListActivity).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText('act-1'.slice(0, 8))).toBeInTheDocument();
    });
  });

  it('renders loading state', async () => {
    mockListActivity.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><Activity /></MemoryRouter>);
    expect(screen.getByText('Loading activity...')).toBeInTheDocument();
  });

  it('renders activity table with correct data', async () => {
    mockListActivity.mockResolvedValue({
      activity: [
        {
          id: 'act-1',
          agentId: 'agent-a',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'submitted',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('act-1'.slice(0, 8))).toBeInTheDocument();
    });
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('payment')).toBeInTheDocument();
  });

  it('renders agent display names for known agents and falls back to raw ID for unknown agents', async () => {
    mockListAllAgents.mockResolvedValue({
      agents: [
        { id: 'agent-1', displayName: 'Treasury' },
        { id: 'agent-2', displayName: 'Payroll' },
      ],
      total: 2,
      truncated: false,
    });
    mockListActivity.mockResolvedValue({
      activity: [
        {
          id: 'act-1',
          agentId: 'agent-1',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'submitted',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'act-2',
          agentId: 'agent-2',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '20', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'confirmed',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'act-3',
          agentId: 'agent-deleted-9999',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '30', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'failed',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      hasMore: false,
    });

    render(<MemoryRouter><Activity /></MemoryRouter>);

    expect(await screen.findByText('Treasury')).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(screen.getByText('agent-deleted-9999')).toBeInTheDocument();
    expect(mockListAllAgents).toHaveBeenCalledTimes(1);
  });

  it('calls loadMore to fetch additional pages', async () => {
    // Initial page
    mockListActivity.mockResolvedValueOnce({
      activity: [
        {
          id: 'act-1',
          agentId: 'agent-a',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'submitted',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      hasMore: true,
    });

    // Second page
    mockListActivity.mockResolvedValueOnce({
      activity: [
        {
          id: 'act-2',
          agentId: 'agent-b',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '20', destination: 'G...', reason: 'test2' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'confirmed',
          error: null,
          createdAt: '2026-01-01T00:00:01Z',
          updatedAt: '2026-01-01T00:00:01Z',
        },
      ],
      hasMore: false,
    });

    render(<MemoryRouter><Activity /></MemoryRouter>);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('act-1'.slice(0, 8))).toBeInTheDocument();
    });

    // Click Load More
    const loadMoreButton = screen.getByRole('button', { name: /load more/i });
    fireEvent.click(loadMoreButton);

    // Wait for second page to load
    await waitFor(() => {
      expect(screen.getByText('act-2'.slice(0, 8))).toBeInTheDocument();
    });

    expect(mockListActivity).toHaveBeenCalledTimes(2);
  });

  it('handles loadMore error and shows retry button', async () => {
    // Initial page succeeds
    mockListActivity.mockResolvedValueOnce({
      activity: [
        {
          id: 'act-1',
          agentId: 'agent-a',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'submitted',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      hasMore: true,
    });

    // Load more fails
    mockListActivity.mockRejectedValueOnce(new Error('Network timeout'));

    // Retry succeeds
    mockListActivity.mockResolvedValueOnce({
      activity: [
        {
          id: 'act-2',
          agentId: 'agent-b',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '20', destination: 'G...', reason: 'test2' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'confirmed',
          error: null,
          createdAt: '2026-01-01T00:00:01Z',
          updatedAt: '2026-01-01T00:00:01Z',
        },
      ],
      hasMore: false,
    });

    render(<MemoryRouter><Activity /></MemoryRouter>);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('act-1'.slice(0, 8))).toBeInTheDocument();
    });

    // Click Load More
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });

    // Click Retry
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Wait for second page to load
    await waitFor(() => {
      expect(screen.getByText('act-2'.slice(0, 8))).toBeInTheDocument();
    });

    expect(mockListActivity).toHaveBeenCalledTimes(3);
  });

  it('navigates to activity detail when clicking a row', async () => {
    mockListActivity.mockResolvedValue({
      activity: [
        {
          id: 'act-123',
          agentId: 'agent-abc',
          ownerId: 'owner-a',
          intent: { type: 'payment', asset: 'XLM', amount: '10', destination: 'G...', reason: 'test' },
          policyDecision: { result: 'allow', reason: 'ok', rule: 'test', intent: {} as any },
          authorizationStatus: null,
          simulationResult: null,
          txHash: null,
          status: 'submitted',
          error: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      hasMore: false,
    });

    const NavigationTest = () => (
      <div data-testid="navigation-target">Activity Detail Page</div>
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Activity />} />
          <Route path="/agents/:agentId/activity/:activityId" element={<NavigationTest />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for activity to load
    await waitFor(() => {
      expect(screen.getByText('act-123'.slice(0, 8))).toBeInTheDocument();
    });

    // Click the row
    const row = screen.getByText('act-123'.slice(0, 8)).closest('tr');
    fireEvent.click(row!);

    // Verify navigation occurred
    await waitFor(() => {
      expect(screen.getByTestId('navigation-target')).toBeInTheDocument();
      expect(screen.getByText('Activity Detail Page')).toBeInTheDocument();
    });
  });
});
