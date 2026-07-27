**Risk and Watchlist**

Трасти работает с лоанами с Overview (блок Needs Attention) и со страницы Loans. Статус меняется всегда в одном месте: с карточки лоана кнопка Update lifecycle открывает форму, в ней и статус, и CCR, и локация, и документ. 

**Что показываем в таблице лоанов и в карточке**

1. Cтатус. (Согласно [https://docs.google.com/document/d/11x0jIj3CjiAod1tJbDaFHQFifmzVY8ljfqiQtp0YLig/edit?tab=t.0](https://docs.google.com/document/d/11x0jIj3CjiAod1tJbDaFHQFifmzVY8ljfqiQtp0YLig/edit?tab=t.0)  
2. CCR: значение, цвет.  
3. Ближайший платеж: дата, либо сколько дней просрочки.

**Цвета CCR**

- ниже 130% \- желтый. Повод поставить Watchlist и needs attention.  
- ниже 120% \- оранжевый. Margin call заемщику через оригинатора.  
- ниже 110% \- красный. Жесткий margin call.  
- серый \- значение протухло, надо обновить.

**Когда трасти руками ставит Watchlist**

1. CCR упал ниже 130%.  
2. Пропущен купон, а maturity еще не прошла. отображение в needs attention со счетчиком просрочки.

**Просрочка по maturity это не Watchlist**

Если прошла дата погашения и денег нет, статус **Past Due**, записывать платежи и минтить по этому займу нельзя. Ставить **Past Due** нужно только если денег действительно не было. Если деньги пришли, а трасти просто еще не записал платеж, то надо идти записывать платеж, а не менять статус. 

Поэтому на выборе Past Due показываем окно подтверждения: предупреждение что запись и минты залочатся, и список входящих переводов по этому займу. И текст: “WARNING\! Past Due Loans are effectively locked for any changes and interest intakes. Make sure there are no unrecorded payments related to this Loan before changing its status to Past Due” 

**Возврат в Performing**

Из Watchlist обратно в Performing \- та же форма, одна кнопка, мгновенно, без таймлока. Выход должен быть так же заметен в UX, как вход, иначе лоаны копятся в Watchlist.

**Эскалация**

Default и закрытие с убытком трасти не может в принципе. Только Risk Council, 3 из 5, 24 часа таймлока, Guardian может отменить. Трасти только собирает proposal: с карточки лоана кнопка Escalate to council, дальше Proposal builder (форма с названием и текстом proposal), дальше таймер и отображение в разделе Risk Council как в макетах. 