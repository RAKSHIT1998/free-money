import cn from './utils';

interface SkeletonProps {
  className?: string;
  height?: number | string;
  width?: number | string | 'full';
  rounded?: boolean;
  animate?: boolean;
}

export const Skeleton = ({
  className = '',
  height = 16,
  width = 'full',
  rounded = false,
  animate = true,
}: SkeletonProps) => {
  const sizeStyles = `
    h-${typeof height === 'number' ? height : height}
    w-${typeof width === 'number' ? width : width === 'full' ? 'full' : width}
  `;

  const roundedStyles = rounded ? 'rounded' : '';
  const animateStyles = animate ? 'animate-pulse' : '';

  return (
    <div
      className={cn(
        'bg-gray-200',
        roundedStyles,
        sizeStyles,
        animateStyles,
        className
      )}
    />
  );
};