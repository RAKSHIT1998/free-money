import React from 'react';
import cn from './utils';

interface BadgeProps {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  className?: string;
  children: React.ReactNode;
}

export const Badge = ({
  variant = 'default',
  className = '',
  children,
}: BadgeProps) => {
  const variantClasses = {
    default: 'bg-gray-200 text-gray-800',
    primary: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    success: 'bg-green-500 text-green-50',
    warning: 'bg-yellow-500 text-yellow-50',
    error: 'bg-red-500 text-red-50',
  }[variant];

  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
      variantClasses,
      className
    )}>
      {children}
    </span>
  );
};