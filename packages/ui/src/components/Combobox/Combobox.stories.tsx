// spec: docs/frontend/ui-components.md#combobox
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Combobox } from "./Combobox";
import type { ComboboxOption } from "./filterOptions";

const flag = (code: string) => `https://flagcdn.com/${code}.svg`;

const COUNTRIES: ComboboxOption[] = [
  { value: "France", label: "France", iconUrl: flag("fr"), keywords: ["FR"] },
  {
    value: "Netherlands",
    label: "Netherlands",
    iconUrl: flag("nl"),
    keywords: ["NL"],
  },
  { value: "Peru", label: "Peru", iconUrl: flag("pe"), keywords: ["PE"] },
  {
    value: "United States",
    label: "United States",
    iconUrl: flag("us"),
    keywords: ["US"],
  },
];

const meta = {
  title: "Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
  args: {
    value: "",
    onChange: () => {},
    options: COUNTRIES,
    placeholder: "Search country",
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof Combobox>) {
  const [value, setValue] = useState(args.value);
  return (
    <div style={{ width: 400, minHeight: 360 }}>
      <Combobox {...args} value={value} onChange={setValue} />
    </div>
  );
}

export const Default: Story = { render: (args) => <Controlled {...args} /> };

export const WithFlags: Story = {
  args: { value: "Peru" },
  render: (args) => <Controlled {...args} />,
};

export const FilteredNoMatches: Story = {
  args: { options: [], emptyText: "No countries found" },
  render: (args) => <Controlled {...args} />,
};

export const Disabled: Story = {
  args: { disabled: true, placeholder: "Loading countries…" },
  render: (args) => <Controlled {...args} />,
};

export const Invalid: Story = {
  args: { invalid: true, error: "Pick a country" },
  render: (args) => <Controlled {...args} />,
};
