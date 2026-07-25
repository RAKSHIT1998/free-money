import { useWallet } from '../hooks';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { FCreditCard, FExchangeDown, FExchangeUp, FActivity } from 'react-icons/fi';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

const WalletPage = () => {
  const { balance, transactions, loading, error, deposit, withdraw, refresh } = useWallet();
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [depositDescription, setDepositDescription] = useState('');
  const [withdrawDescription, setWithdrawDescription] = useState('');

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      // Show error toast
      return;
    }

    const success = await deposit(amount, depositDescription || 'Deposit');
    if (success) {
      setDepositModalOpen(false);
      setDepositAmount('');
      setDepositDescription('');
      // Show success toast
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      // Show error toast
      return;
    }

    const success = await withdraw(amount, withdrawDescription || 'Withdrawal');
    if (success) {
      setWithdrawModalOpen(false);
      setWithdrawAmount('');
      setWithdrawDescription('');
      // Show success toast
    }
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const relativeTime = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  return (
    <div>
      <Toaster position="top-right" />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your funds and view transaction history</p>
      </div>

      {/* Balance Section */}
      <div className="mb-6">
        <Card className="text-center">
          {loading ? (
            <div className="space-y-4">
              <Skeleton height={24} width="32" className="mx-auto" />
              <Skeleton height={20} width="40" className="mx-auto" />
              <Skeleton height={16} width="32" className="mx-auto" />
            </div>
          ) : (
            <>
              {balance ? (
                <>
                  <p className="text-sm font-medium text-gray-500">Current Balance</p>
                  <p className="text-4xl font-bold mt-2">{formatCurrency(balance.balance)}</p>
                  <p className="text-sm text-gray-500 mt-2">
                    Last updated: {formatDate(balance.lastUpdated)}
                  </p>
                  <div className="mt-4 flex justify-center space-x-4">
                    <Button
                      variant="outline"
                      onClick={() => setDepositModalOpen(true)}
                      className="w-full md:w-auto"
                    >
                      Deposit
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setWithdrawModalOpen(true)}
                      className="w-full md:w-auto"
                    >
                      Withdraw
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-gray-500">Unable to load balance</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Transaction Filters */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => { /* Filter all transactions */ }}
            className="px-3 py-1 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200"
          >
            All
          </button>
          <button
            onClick={() => { /* Filter deposits */ }}
            className="px-3 py-1 rounded-md text-sm font-medium bg-green-100 hover:bg-green-200"
          >
            Deposits
          </button>
          <button
            onClick={() => { /* Filter withdrawals */ }}
            className="px-3 py-1 rounded-md text-sm font-medium bg-red-100 hover:bg-red-200"
          >
            Withdrawals
          </button>
          <button
            onClick={() => { /* Filter earnings */ }}
            className="px-3 py-1 rounded-md text-sm font-medium bg-yellow-100 hover:bg-yellow-200"
          >
            Earnings
          </button>
          <Button variant="outline" size="sm">
            <FActivity size={16} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Transaction History */}
      <Card>
        <div className="flex items-center justify-between pb-4">
          <h3 className="text-lg font-semibold">Transaction History</h3>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start space-x-3 p-3">
                <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1 space-y-1">
                  <Skeleton height={16} width="2/3" />
                  <Skeleton height={14} width="1/2" className="mt-1" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No transactions found</p>
                <button
                  onClick={() => { /* Trigger refresh */ }}
                  className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
                >
                  Refresh Transactions
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-start space-x-3 p-4 border-t border-gray-200">
                    <div className="flex-shrink-0">
                      {tx.type === 'deposit' ? (
                        <FExchangeUp size={24} className="text-green-500" />
                      ) : tx.type === 'withdrawal' ? (
                        <FExchangeDown size={24} className="text-red-500" />
                      ) : (
                        <FActivity size={24} className="text-yellow-500" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-medium">{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</h4>
                        <p className="text-sm text-gray-500">{relativeTime(tx.timestamp)}</p>
                      </div>
                      <p className="font-semibold">{formatCurrency(tx.amount)}</p>
                      {tx.description && <p className="text-sm text-gray-600">{tx.description}</p>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {tx.type === 'deposit' || tx.type === 'earning' ? (
                        <span className="text-green-500 font-medium">+{formatCurrency(tx.amount)}</span>
                      ) : (
                        <span className="text-red-500 font-medium">-{formatCurrency(tx.amount)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-4">
          <Button variant="outline" size="sm" onClick={refresh}>
            <FActivity size={16} className="mr-2" /> Refresh
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default WalletPage;