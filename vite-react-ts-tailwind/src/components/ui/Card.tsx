import React from 'react';
import cn from './utils';

interface CardProps {
  className?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const Card = ({
  className = '',
  header,
  footer,
  children,
}: CardProps) => {
  return (
    <div className={cn(
      'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700',
      className
    )}>
      {header && <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">{header}</div>}
      <div className="p-6">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">{footer}</div>}
    </div>
  );
};