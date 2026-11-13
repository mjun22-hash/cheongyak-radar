export type Verdict = 'eligible' | 'review' | 'ineligible'
export type SupplyKind =
  | 'general_first'
  | 'general_second'
  | 'special_first_home'
  | 'special_newlywed'
  | 'special_multi_child'
  | 'special_newborn'
  | 'special_elderly_parent'
  | 'remaining'

export interface Profile {
  birth_year: number
  marital_status: 'single' | 'married'
  children: number
  household_size: number
  is_household_head: boolean
  homeless: boolean
  no_win_last_5_years: boolean | null
  never_owned_home: boolean | null
  income_tax_paid_5_years: boolean | null
  residence: { sido: string; sigungu: string; registered_since: string }
  account: {
    type: string
    rank_base_date: string
    total_deposit_krw: number | null
    deposit_count_estimate: number | null
    verified: boolean
  }
  income: { gross_annual_krw: number | null; basis_verified: boolean }
  assets: {
    financial_krw: number | null
    real_estate_krw: number | null
    car_value_krw: number | null
    verified: boolean
  }
}

export interface HousingType {
  name: string
  area_sqm: number | null
  households: number | null
  price_krw: number | null
}

export interface SupplyOption {
  id: string
  label: string
  kind: SupplyKind
  min_age?: number
  max_area_sqm?: number
  min_account_months?: number
  min_deposit_count?: number
  min_deposit_krw?: number
  requires_homeless?: boolean | null
  requires_household_head?: boolean
  residence_sido?: string
  residence_min_months?: number
  max_income_krw?: number
  max_assets_krw?: number
  requirements_complete: boolean
  source_ref: string
}

export interface PriceComparable {
  name: string
  month: string
  area_sqm: number
  price_krw: number
  legal_dong?: string
  build_year?: number
  floor?: number
  market_krw?: number
  trade_count?: number
}

export interface PriceTypeEstimate {
  housing_type: string
  area_sqm: number
  sale_price_krw: number
  market_low_krw: number
  market_base_krw: number
  market_high_krw: number
  gain_low_krw: number
  gain_base_krw: number
  gain_high_krw: number
  confidence: 'high' | 'medium' | 'low'
  scope: 'same_dong' | 'sigungu'
  method?: 'strict' | 'regional_relaxed' | 'nearest_area' | 'homedubu'
  age_limit_years: number
  trade_count: number
  complex_count: number
  comparables: PriceComparable[]
}

export interface Announcement {
  id: string
  notice_number: string
  name: string
  is_sample?: boolean
  region: { sido: string; sigungu: string; address: string }
  total_households: number | null
  housing_category: 'private' | 'national' | 'remaining' | 'unknown'
  announcement_date: string
  application_start: string | null
  application_end: string | null
  winner_date: string | null
  contract_start: string | null
  contract_end: string | null
  move_in_month?: string | null
  links: { official: string; homepage?: string | null; homedubu?: string | null }
  homedubu?: {
    url: string
    title: string
    rating?: number | null
    gain_estimate_krw?: number | null
    gain_basis?: string | null
    cash_needed_krw?: number | null
    checked_at: string
  }
  policy?: {
    regulated: boolean | null
    price_cap: boolean | null
    public_land: boolean | null
    large_land: boolean | null
  }
  notice_analysis?: {
    status: 'parsed' | 'not_found' | 'error'
    source_url: string | null
    checked_at: string
    parser_version?: string
    facts: Record<string, string>
  }
  housing_types: HousingType[]
  supply_options: SupplyOption[]
  price_gain: {
    status: 'estimated' | 'unavailable'
    estimated_krw: number | null
    estimated_low_krw?: number | null
    estimated_high_krw?: number | null
    market_estimated_krw?: number | null
    confidence?: 'high' | 'medium' | 'low'
    housing_type?: string
    basis: string
    comparables: PriceComparable[]
    by_type?: PriceTypeEstimate[]
  }
  restrictions: { resale: string | null; residence: string | null }
}

export interface AnnouncementData {
  metadata: {
    generated_at: string
    source: string
    is_sample: boolean
    last_fetch_error: string | null
    count: number
  }
  announcements: Announcement[]
}

export interface Evaluation {
  option: SupplyOption
  housingType: HousingType
  verdict: Verdict
  reasons: string[]
  sourceRef: string
}

export interface AnnouncementEvaluation {
  verdict: Verdict
  best: Evaluation | null
  all: Evaluation[]
}
