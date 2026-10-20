WITH ordered_variants AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY sort_order, created_at, id
    ) - 1 AS stable_sort_order
  FROM public.product_variants
  WHERE is_active = TRUE
)
UPDATE public.product_variants AS variants
SET sort_order = ordered_variants.stable_sort_order
FROM ordered_variants
WHERE variants.id = ordered_variants.id
  AND variants.sort_order <> ordered_variants.stable_sort_order;
