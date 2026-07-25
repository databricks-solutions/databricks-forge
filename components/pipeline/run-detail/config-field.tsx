export interface ConfigFieldProps {
  label: string;
  value: string;
  badge?: string;
}

export function ConfigField({ label, value, badge }: ConfigFieldProps) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">
        {value}
        {badge && (
          <span className="ml-1.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {badge}
          </span>
        )}
      </p>
    </div>
  );
}
